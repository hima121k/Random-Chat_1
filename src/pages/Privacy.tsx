export default function Privacy() {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-12 animate-in fade-in duration-500">
      <h1 className="text-4xl font-extrabold text-rc-text mb-8">Privacy Policy</h1>
      
      <div className="space-y-8 text-rc-muted leading-relaxed">
        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">1. Information We Collect</h2>
          <p>
            When you use RandomChat, we may collect the following information:
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li><strong>Account Information:</strong> If you sign up, we store your email address, phone number (if provided), and basic profile details like your nickname and avatar.</li>
            <li><strong>Usage Data:</strong> We may collect anonymous analytics data regarding how you interact with the platform to improve our services.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">2. End-to-End Encryption & WebRTC</h2>
          <p>
            RandomChat utilizes WebRTC for video and audio communication. This means your media streams are sent directly from your device to the stranger's device (Peer-to-Peer).
          </p>
          <p className="mt-4">
            We <strong>do not</strong> have access to, record, or store your video or audio streams. Your text chat messages are also encrypted and transmitted securely.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">3. How We Use Your Information</h2>
          <p>We use your information solely to:</p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>Provide, operate, and maintain the RandomChat platform.</li>
            <li>Match you with other users based on your preferences.</li>
            <li>Prevent fraud, abuse, and enforce our Terms of Service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">4. Third-Party Services</h2>
          <p>
            We use Firebase (by Google) for authentication and database management. Your data is stored securely on Firebase servers and is subject to Google's Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">5. Your Rights</h2>
          <p>
            You have the right to access, update, or delete your personal information at any time. You can delete your account by contacting our support team or using the in-app settings (if available).
          </p>
        </section>

        <div className="pt-8 border-t border-rc-border text-sm">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
