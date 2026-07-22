import { Card } from '@/components/ui/card';

export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Data Privacy Notice</div>
      <h1 className="mb-2 text-2xl">How SafeDrive handles your information</h1>
      <p className="mb-6 text-sm text-muted">
        SafeDrive is a school capstone project — a working simulation of a peer-to-peer car rental platform, not a
        commercially operating company. It is not registered with the National Privacy Commission as a personal
        information controller, and nothing on this page is a certified legal document. This notice exists to be
        transparent about what the system actually collects and why, in the spirit of the Philippine Data Privacy
        Act of 2012 (RA 10173).
      </p>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">What we collect</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Account details: name, email, phone number, address, birthday.</li>
          <li>Identity verification documents: driver's license and a secondary government ID (front and back photos).</li>
          <li>Two live camera selfies (holding your ID, and face only) captured during verification, used to confirm you're a real person matching your documents — the face-only selfie also becomes your visible profile picture once verified.</li>
          <li>Vehicle documents if you list a car: ORCR, plate number, and a rental agreement.</li>
          <li>Payout details if you list a car: bank account or GCash number, for receiving rental income.</li>
          <li>Booking, payment, chat, and review activity within the app.</li>
        </ul>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">Why we collect it</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>To verify you're a real, eligible person before you can book or list a vehicle (fraud and safety).</li>
          <li>To operate bookings: matching renters and owners, processing payments, and handling disputes.</li>
          <li>To let the other party in a booking know who they're renting from/to (name, rating, profile picture).</li>
          <li>To respond to support requests and enforce platform rules (strikes, suspensions, bans).</li>
        </ul>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-bold">Who can see it</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>ID documents and non-face-only selfies are private — visible only to you and platform admins reviewing your submission.</li>
          <li>Your name, verification badge, rating, and profile picture are visible to the other party once you have an active booking together.</li>
          <li>Payout account details are visible only to you and admins processing payouts.</li>
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-bold">Your choices</h2>
        <p className="text-sm text-muted">
          You can update your phone number and address at any time from your Profile. Identity documents can only
          be changed by submitting a new verification review. If you'd like your data removed from this
          demonstration system, use the Inquire chat to reach the project maintainers.
        </p>
      </Card>
    </div>
  );
}
