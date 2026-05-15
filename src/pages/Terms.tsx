export default function Terms() {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-12 animate-in fade-in duration-500">
      <h1 className="text-4xl font-extrabold text-rc-text mb-8">Terms of Service</h1>
      
      <div className="space-y-8 text-rc-muted leading-relaxed">
        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">1. Acceptance of Terms</h2>
          <p>
            By accessing or using RandomChat, you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, please do not use our service. You must be at least 13 years old to use RandomChat.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">2. User Conduct</h2>
          <p>You agree to use RandomChat respectfully and lawfully. You are strictly prohibited from:</p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>Sharing illegal, explicit, or inappropriate content.</li>
            <li>Harassing, bullying, or intimidating other users.</li>
            <li>Spamming, distributing malware, or scraping data.</li>
            <li>Impersonating others or providing false information.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">3. Privacy & Security</h2>
          <p>
            Your privacy is important to us. All video and text chats are peer-to-peer and are not recorded or stored on our servers. 
            However, please be cautious about sharing personal information with strangers. Read our full <a href="/privacy" className="text-rc-accent hover:underline">Privacy Policy</a> for more details.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">4. Termination</h2>
          <p>
            We reserve the right to suspend or terminate your access to RandomChat at any time, without notice, 
            for conduct that we believe violates these Terms of Service or is harmful to other users of the application.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-rc-text mb-4">5. Disclaimer of Warranties</h2>
          <p>
            RandomChat is provided "as is" and "as available" without any warranties of any kind. 
            We do not guarantee that the service will be uninterrupted, secure, or error-free.
          </p>
        </section>

        <div className="pt-8 border-t border-rc-border text-sm">
          <p>Last updated: {new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
