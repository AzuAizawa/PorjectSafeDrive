import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Why do I need to get verified?',
    a: "Verification confirms your identity with a government ID and driver's license before you can book or list a vehicle — it protects both renters and owners. Submit your details and photos on the Get Verified page; admin usually reviews it within a day.",
  },
  {
    q: 'My verification was rejected — what now?',
    a: 'Check the rejection reason on the Get Verified page and resubmit with corrected info or clearer photos. There\'s no limit on how many times you can resubmit.',
  },
  {
    q: 'How does pricing work when I book a car?',
    a: 'The total price is the daily rate × number of days, plus a service fee. You pay 50% as a downpayment once the owner accepts, and the remaining balance before pickup — the owner won\'t hand over the car until the balance shows as paid.',
  },
  {
    q: 'Can I cancel a booking?',
    a: "Yes. Cancelling is free before the owner accepts, or within the free-cancellation window after paying. Cancelling later applies a fee — My Bookings shows you the exact amount before you confirm.",
  },
  {
    q: 'How do I list my own car?',
    a: 'Switch to Lister from your profile menu, then Add Vehicle. You\'ll need your car\'s ORCR, photos, and details — admin reviews it before it goes live, same as identity verification.',
  },
  {
    q: 'What if something goes wrong during my rental?',
    a: 'Use "Report an Issue" on the specific booking in My Bookings — that creates a case admin can review with any evidence you attach. For a general question that isn\'t about a specific booking, use Inquire instead.',
  },
  {
    q: "What's the difference between Inquire and Report an Issue?",
    a: 'Report an Issue is for a problem with a specific booking (damage, a no-show, etc.) and is reviewed as a case. Inquire is just a general chat with support for anything else — account questions, how something works, and so on.',
  },
];

export function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Support</div>
        <h1 className="text-2xl">Help</h1>
        <p className="mt-1.5 text-muted">Answers to common questions — or reach support directly.</p>
      </div>

      <Card className="mb-5 p-2">
        {FAQ.map((item, i) => (
          <div key={item.q} className="border-b border-line last:border-none">
            <button
              className="flex w-full items-center justify-between px-3.5 py-3.5 text-left text-sm font-semibold"
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              aria-expanded={openIndex === i}
            >
              {item.q}
              <span className="text-muted">{openIndex === i ? '−' : '+'}</span>
            </button>
            {openIndex === i ? <p className="px-3.5 pb-3.5 text-sm text-muted">{item.a}</p> : null}
          </div>
        ))}
      </Card>

      <Card className="flex items-center justify-between p-5">
        <div>
          <h3 className="text-sm font-bold">Still need help?</h3>
          <p className="mt-0.5 text-xs text-muted">Ask SafeDrive support directly — usually replies within a day.</p>
        </div>
        <Link to="/inquire"><Button>💬 Open Inquire Chat</Button></Link>
      </Card>
    </div>
  );
}
