import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Zap, Sparkles, Shield, Rocket, ArrowLeft, Star, Ticket } from 'lucide-react';
import { auth } from '../lib/firebase';
import { validateCoupon, type Coupon } from '../services/admin';

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isLoading, setIsLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubscribe = async (plan: 'monthly' | 'yearly') => {
    if (!auth?.currentUser) {
      navigate('/', { state: { from: '/pricing' } });
      return;
    }

    setIsLoading(true);
    // In a real implementation, this would call a backend function to create a Stripe Checkout session
    // For now, we'll simulate the intent
    const discount = appliedCoupon ? appliedCoupon.discountPercent : 0;
    const originalPrice = plan === 'monthly' ? 49 : 399;
    const finalPrice = Math.round(originalPrice * (1 - discount / 100));

    console.log(`Subscribing to ${plan} plan with ${discount}% discount...`);
    
    // Simulate redirection to Stripe
    setTimeout(() => {
      setIsLoading(false);
      alert(`In a production environment, you would now be redirected to Stripe Checkout.\n\nSummary:\nPlan: ${plan}\nOriginal: ₹${originalPrice}\nDiscount: ${discount}%\nTotal: ₹${finalPrice}`);
    }, 800);
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsLoading(true);
    setCouponError(null);
    try {
      const coupon = await validateCoupon(couponCode);
      if (coupon) {
        setAppliedCoupon(coupon);
        setCouponCode('');
      } else {
        setCouponError('Invalid or expired coupon code.');
        setAppliedCoupon(null);
      }
    } catch {
      setCouponError('Failed to validate coupon.');
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { name: 'Priority Matchmaking', desc: 'Get matched up to 3x faster than free users', icon: <Zap className="text-rc-accentGlow" size={18} /> },
    { name: 'Gender Filtering', desc: 'Choose to match with specific genders', icon: <Sparkles className="text-rc-accentGlow" size={18} /> },
    { name: 'Premium Pro Badge', desc: 'A special golden badge next to your name', icon: <Star className="text-amber-400" size={18} /> },
    { name: 'Unlimited Avatars', desc: 'No limits on custom avatar creations', icon: <Shield className="text-rc-accentGlow" size={18} /> },
    { name: 'Ad-Free Experience', desc: 'Zero interruptions during your chats', icon: <Rocket className="text-rc-accentGlow" size={18} /> },
  ];

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-rc-accent/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Back Button */}
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-rc-muted hover:text-rc-text transition-colors mb-8 group"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          <span>Back</span>
        </button>

        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 bg-gradient-to-r from-rc-text via-rc-accentGlow to-indigo-300 bg-clip-text text-transparent">
            Upgrade to Pro
          </h1>
          <p className="text-rc-muted text-lg max-w-2xl mx-auto">
            Support the community and unlock premium features to enhance your chat experience.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mt-10">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-rc-text' : 'text-rc-muted'}`}>Monthly</span>
            <button 
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
              className="w-14 h-7 bg-rc-surface border border-rc-border rounded-full relative p-1 transition-colors hover:border-rc-accent/50"
            >
              <div className={`w-5 h-5 bg-rc-accent rounded-full transition-transform shadow-glowSm ${billingCycle === 'yearly' ? 'translate-x-7' : 'translate-x-0'}`} />
            </button>
            <span className={`text-sm font-medium ${billingCycle === 'yearly' ? 'text-rc-text' : 'text-rc-muted'}`}>
              Yearly <span className="text-green-400 text-xs ml-1 font-bold">SAVE 30%</span>
            </span>
          </div>

          {/* Coupon Section */}
          <div className="mt-8 max-w-sm mx-auto">
            {!appliedCoupon ? (
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Promo Code"
                  className="flex-1 bg-rc-surface border border-rc-border rounded-xl px-4 py-2 text-sm text-white focus:border-rc-accent outline-none"
                />
                <button 
                  onClick={handleApplyCoupon}
                  disabled={isLoading || !couponCode.trim()}
                  className="bg-rc-surface hover:bg-rc-bg border border-rc-border rounded-xl px-4 py-2 text-xs font-bold text-rc-text transition-all disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            ) : (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Ticket className="text-green-400" size={14} />
                  <span className="text-xs font-bold text-green-400">Coupon "{appliedCoupon.code}" Applied!</span>
                </div>
                <button 
                  onClick={() => setAppliedCoupon(null)}
                  className="text-[10px] text-rc-muted hover:text-rc-text underline"
                >
                  Remove
                </button>
              </div>
            )}
            {couponError && <p className="text-[10px] text-red-400 mt-1 text-center">{couponError}</p>}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-stretch max-w-4xl mx-auto">
          {/* Free Plan */}
          <div className="card p-8 flex flex-col border-rc-border/50 opacity-80">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-rc-text">Basic</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">₹0</span>
                <span className="text-rc-muted text-sm">/forever</span>
              </div>
              <p className="text-rc-muted text-sm mt-2">Perfect for casual chatting</p>
            </div>

            <div className="space-y-4 mb-8 flex-1">
              <div className="flex items-start gap-3 text-sm text-rc-text">
                <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
                <span>Standard Matchmaking</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-rc-text">
                <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
                <span>Unlimited Text Messages</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-rc-muted">
                <Check size={16} className="text-rc-muted/30 mt-0.5 shrink-0" />
                <span className="line-through">Priority Matching</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-rc-muted">
                <Check size={16} className="text-rc-muted/30 mt-0.5 shrink-0" />
                <span className="line-through">Gender Filtering</span>
              </div>
            </div>

            <button 
              disabled 
              className="w-full py-3 bg-rc-surface border border-rc-border rounded-xl text-rc-muted font-semibold text-sm cursor-not-allowed"
            >
              Current Plan
            </button>
          </div>

          {/* Pro Plan */}
          <div className="card p-8 flex flex-col relative border-rc-accent shadow-glow overflow-hidden">
            {/* Popular Badge */}
            <div className="absolute top-0 right-0">
              <div className="bg-rc-accent text-white text-[10px] font-bold px-8 py-1 rotate-45 translate-x-6 translate-y-2 uppercase tracking-tighter">
                Premium
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-bold text-rc-text flex items-center gap-2">
                Pro
                <Sparkles size={18} className="text-rc-accentGlow" />
              </h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-rc-text">
                  {appliedCoupon ? (
                    <span className="flex items-center gap-2">
                      <span className="line-through text-rc-muted text-2xl">₹{billingCycle === 'monthly' ? '49' : '399'}</span>
                      <span>₹{Math.round((billingCycle === 'monthly' ? 49 : 399) * (1 - appliedCoupon.discountPercent / 100))}</span>
                    </span>
                  ) : (
                    `₹${billingCycle === 'monthly' ? '49' : '399'}`
                  )}
                </span>
                <span className="text-rc-muted text-sm">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
              </div>
              <p className="text-rc-accentGlow text-sm mt-2 font-medium">Best value for power users</p>
            </div>

            <div className="space-y-4 mb-8 flex-1">
              {features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-3 group">
                  <div className="mt-0.5 shrink-0">{feature.icon}</div>
                  <div>
                    <p className="text-sm font-semibold text-rc-text">{feature.name}</p>
                    <p className="text-xs text-rc-muted">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={() => handleSubscribe(billingCycle)}
              disabled={isLoading}
              className="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2 shadow-glow"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Zap size={18} strokeWidth={2.5} />
                  Upgrade Now
                </>
              )}
            </button>
          </div>
        </div>

        {/* FAQ/Trust footer */}
        <div className="mt-20 text-center">
          <p className="text-rc-muted text-sm">
            Secure payments processed via Stripe. Cancel anytime.
          </p>
          <div className="flex items-center justify-center gap-6 mt-4 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <Shield size={24} />
            <Rocket size={24} />
            <Star size={24} />
          </div>
        </div>
      </div>
    </div>
  );
}
