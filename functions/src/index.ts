import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

admin.initializeApp();
const db = admin.firestore();

// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET should be set in Firebase Config or environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as any,
});

const REPORT_THRESHOLD = 3;

/**
 * Auto-ban Cloud Function
 */
export const onReportCreated = functions.firestore
  .document('reports/{reportId}')
  .onCreate(async (snap) => {
    const { reportedId } = snap.data() as { reportedId: string };

    if (!reportedId) {
      functions.logger.error('Report document missing reportedId field', snap.id);
      return;
    }

    // Auto-ban logic is handled client-side in admin.ts with deduplication
    // and role-aware thresholds. This function is kept as a hook for future
    // server-side moderation (e.g., AI content analysis).
    functions.logger.info(`New report created for user ${reportedId}`);
  });

/**
 * Stripe Webhook Handler
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err: any) {
    functions.logger.error('Webhook signature verification failed.', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const subscriptionId = session.subscription as string;

      if (userId) {
        await updateUserSubscription(userId, subscriptionId);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.userId;

      if (userId) {
        await updateUserSubscription(userId, subscription.id);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.userId;

      if (userId) {
        await db.collection('users').doc(userId).update({
          isPro: false,
          status: 'canceled',
        });
        functions.logger.info(`User ${userId} subscription canceled.`);
      }
      break;
    }
    default:
      functions.logger.info(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

async function updateUserSubscription(userId: string, subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const planId = subscription.items.data[0].plan.id;
  const currentPeriodEnd = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);

  await db.collection('users').doc(userId).set({
    isPro: subscription.status === 'active' || subscription.status === 'trialing',
    subscriptionId,
    planId,
    status: subscription.status,
    currentPeriodEnd,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  functions.logger.info(`User ${userId} subscription updated to ${subscription.status}.`);
}
