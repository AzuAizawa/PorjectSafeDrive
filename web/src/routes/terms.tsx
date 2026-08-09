import { Card } from '@/components/ui/card';

export function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Terms of Service</div>
      <h1 className="mb-2 text-2xl">Terms of using SafeDrive</h1>
      <p className="mb-6 text-sm text-muted">
        SafeDrive is a school capstone project — a working simulation of a peer-to-peer car rental platform, not a
        commercially operating company. These terms describe how the simulation actually works so anyone using it
        knows what to expect; they are not a certified legal contract, and PayMongo payments run in test mode only —
        no real money moves. See also the{' '}
        <a href="/privacy" className="font-semibold text-accent hover:underline">Data Privacy Notice</a> for what
        data is collected.
      </p>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">Accounts &amp; verification</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>You must provide accurate information when signing up and submitting identity verification.</li>
          <li>Booking or listing a vehicle requires a verified account (government ID + live selfie review).</li>
          <li>Two-factor authentication is mandatory on every account from your first login and can't be disabled.</li>
          <li>Renters must be at least 21 years old, matching the platform's minimum renter age rule.</li>
        </ul>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">Bookings &amp; payments</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Downpayment, balance, commission, deposit, and cancellation-fee percentages are set by the platform and shown before you confirm any booking.</li>
          <li>Payments are processed through PayMongo in test mode — no real charges occur in this simulation.</li>
          <li>Cancelling a confirmed booking may incur a fee per the platform's published cancellation schedule, shown at the time of cancellation.</li>
          <li>Vehicle handover only occurs once the balance payment is confirmed by the owner.</li>
        </ul>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">Conduct &amp; enforcement</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Listings must be your own vehicle with valid ORCR and a signed rental agreement on file.</li>
          <li>Fraudulent documents, duplicate/reused images, or misrepresenting a vehicle can result in strikes, suspension, or a ban.</li>
          <li>Disputes between renters and owners are reviewed by SafeDrive support/admin using the evidence submitted.</li>
          <li>A banned account may not re-register under a new email — new verification submissions are checked against prior bans.</li>
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-bold">Limitation &amp; contact</h2>
        <p className="text-sm text-muted">
          Because this is a capstone simulation, SafeDrive makes no warranty of uninterrupted service and accepts no
          liability for real-world loss — there is no real fleet, real insurance, or real financial exposure behind
          it. Questions about these terms can be sent through the Inquire chat once you're signed in.
        </p>
      </Card>
    </div>
  );
}
