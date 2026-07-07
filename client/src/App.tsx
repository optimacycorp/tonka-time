import { NavLink, Route, Routes } from "react-router-dom";
import { useState } from "react";

type ReservationDraft = {
  publicId?: string;
  packageSlug: string;
  weekendStartDate: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobsiteStreet: string;
  jobsiteCity: string;
  jobsiteState: string;
  jobsiteZip: string;
  gateAccessNotes: string;
  surfaceAccessNotes: string;
  workDescription: string;
  ownerPermission: boolean;
  isPropertyOwner: boolean;
  deliveryZone?: string;
  damageWaiverChoice: "ACCEPTED" | "DECLINED";
  colorado811Ticket?: string;
};

const serviceCities = [
  "Colorado Springs",
  "Fountain",
  "Security-Widefield",
  "Falcon",
  "Peyton",
  "Monument",
  "Black Forest",
  "Manitou Springs",
];

const faqs = [
  ["How does the weekend rental work?", "We deliver Friday, provide a quick orientation, and pick up Monday."],
  ["Do I need an 811 ticket before digging?", "Yes. Colorado 811 and private utility verification are part of the rental checklist."],
  ["Can I use the excavator on steep slopes?", "No. The MVP site explicitly warns against steep slopes, unstable ground, or public ROW work without permits."],
];

function currency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sky text-slate-900">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-sky/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <NavLink to="/" className="font-display text-2xl font-bold text-soil">
            Tonka Time Rentals
          </NavLink>
          <nav className="hidden gap-5 text-sm font-medium md:flex">
            {[
              ["/weekend-rentals", "Weekend Rentals"],
              ["/service-area", "Service Area"],
              ["/faq", "FAQ"],
              ["/videos", "Videos"],
              ["/contact", "Contact"],
              ["/reserve/package", "Reserve"],
            ].map(([to, label]) => (
              <NavLink key={to} to={to} className="transition hover:text-ember">
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-black/5 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-slate-600">
          Tonka Time Rentals provides equipment rental and basic orientation only. Customers remain responsible for boundaries, permits, locates, private utilities, site conditions, and safe operation.
        </div>
      </footer>
    </div>
  );
}

function HomePage() {
  return (
    <Shell>
      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(223,107,55,0.24),_transparent_35%),linear-gradient(135deg,_#f6ead5_0%,_#f5f1e8_58%,_#d8e4cf_100%)]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="mb-4 inline-flex rounded-full bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-field shadow-card">
                Weekend-only rentals for homeowners
              </p>
              <h1 className="max-w-3xl font-display text-5xl font-bold leading-none text-soil md:text-7xl">
                Weekend Mini Excavator Rentals for DIY Homeowners
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-slate-700">
                Delivered Friday. Picked up Monday. Compact 1.8-ton machine with hydraulic thumb, backyard-friendly sizing, and a quick tutorial to help you start safely.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <NavLink className="rounded-full bg-soil px-6 py-3 font-semibold text-white transition hover:bg-field" to="/reserve/package">
                  Reserve a Weekend
                </NavLink>
                <NavLink className="rounded-full border border-soil px-6 py-3 font-semibold text-soil transition hover:bg-white" to="/weekend-rentals">
                  See the Machine
                </NavLink>
              </div>
              <div className="mt-10 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                {["Local delivery included in planning", "Quick tutorial before you dig", "Hydraulic thumb and expandable tracks", "811 reminders and homeowner checklist"].map((item) => (
                  <div key={item} className="rounded-2xl bg-white/70 px-4 py-3 shadow-card">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-card">
              <div className="rounded-[1.5rem] bg-[linear-gradient(180deg,_#d9c3a7_0%,_#8b5a36_100%)] p-6 text-white">
                <p className="text-sm uppercase tracking-[0.2em] text-white/70">Weekend package</p>
                <h2 className="mt-2 font-display text-3xl font-bold">1.8-ton compact excavator</h2>
                <ul className="mt-6 space-y-3 text-sm text-white/90">
                  <li>Expandable tracks for tighter access</li>
                  <li>Hydraulic thumb for cleanup and material control</li>
                  <li>Fence lines, drainage, culverts, landscaping</li>
                  <li>Starting at {currency(59500)} plus delivery and deposit</li>
                </ul>
              </div>
              <div className="mt-5 rounded-[1.5rem] bg-field p-5 text-white">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">Service area</p>
                <p className="mt-2 text-lg font-semibold">Colorado Springs and El Paso County</p>
                <p className="mt-2 text-sm text-white/80">Extended delivery is available with additional review and fees.</p>
              </div>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              ["1. Pick your weekend", "Friday-to-Monday reservations only, with availability checks and soft holds."],
              ["2. Confirm delivery", "Tell us about the address, access, work area, and property permissions."],
              ["3. Pay and sign", "Checkout, agreement completion, and safety reminders all live in one flow."],
            ].map(([title, body]) => (
              <article key={title} className="rounded-[1.75rem] bg-white p-6 shadow-card">
                <h3 className="font-display text-2xl font-semibold text-soil">{title}</h3>
                <p className="mt-3 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}

function SimplePage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="font-display text-5xl font-bold text-soil">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-700">{intro}</p>
        <div className="mt-10">{children}</div>
      </main>
    </Shell>
  );
}

function WeekendRentalsPage() {
  return (
    <SimplePage title="Weekend Mini Excavator Rentals" intro="Tonka Time Rentals is built around one clear MVP package: a Friday delivery and Monday pickup for homeowners tackling practical digging projects.">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <h2 className="font-display text-2xl text-soil">Good fit projects</h2>
          <ul className="mt-4 space-y-2 text-slate-700">
            <li>Drainage trenching</li>
            <li>Fence line preparation</li>
            <li>Culvert work</li>
            <li>Landscaping and light root cleanup</li>
            <li>Small retaining wall prep</li>
          </ul>
        </div>
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <h2 className="font-display text-2xl text-soil">Not recommended</h2>
          <ul className="mt-4 space-y-2 text-slate-700">
            <li>Steep slopes or unstable ground</li>
            <li>Public right-of-way work without permits</li>
            <li>Heavy demolition</li>
            <li>Deep trenching without a safety plan</li>
            <li>Work near utilities without proper locates</li>
          </ul>
        </div>
      </div>
    </SimplePage>
  );
}

function ServiceAreaPage() {
  return (
    <SimplePage title="Service Area" intro="The MVP classifies jobs as core, extended, or manual review based on city and ZIP so homeowners get a fast answer before checkout.">
      <div className="grid gap-4 md:grid-cols-3">
        {serviceCities.map((city) => (
          <div key={city} className="rounded-2xl border border-black/5 bg-white px-5 py-4 shadow-card">
            {city}
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-[1.75rem] bg-field p-6 text-white">
        <h2 className="font-display text-2xl">Before delivery</h2>
        <p className="mt-3 max-w-3xl text-white/80">
          We use address details, access notes, and delivery-zone rules to decide whether your job is in the core area, extended area, or needs manual review before confirmation.
        </p>
      </div>
    </SimplePage>
  );
}

function FAQPage() {
  return (
    <SimplePage title="Frequently Asked Questions" intro="The public site keeps the common reservation, safety, and delivery questions in one place so homeowners know what to expect.">
      <div className="space-y-4">
        {faqs.map(([question, answer]) => (
          <article key={question} className="rounded-[1.5rem] bg-white p-6 shadow-card">
            <h2 className="font-display text-2xl text-soil">{question}</h2>
            <p className="mt-3 text-slate-700">{answer}</p>
          </article>
        ))}
      </div>
    </SimplePage>
  );
}

function SafetyChecklistPage() {
  return (
    <SimplePage title="Safety and Homeowner Checklist" intro="Small machine. Real excavation risks. Mini excavators can damage utilities, structures, and people if they are used carelessly or without site verification.">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <h2 className="font-display text-2xl text-soil">Before you dig</h2>
          <ul className="mt-4 space-y-2 text-slate-700">
            <li>Know your boundaries and permissions</li>
            <li>Submit Colorado 811 and verify private utilities</li>
            <li>Check HOA, permit, easement, and setback rules</li>
            <li>Keep kids, pets, and bystanders away</li>
            <li>Stop if the machine leaks, overheats, or feels unsafe</li>
          </ul>
        </div>
        <div className="rounded-[1.75rem] bg-ember p-6 text-white shadow-card">
          <h2 className="font-display text-2xl">811 reminder</h2>
          <p className="mt-4 text-white/90">
            Public utility markings may not include irrigation, septic, propane, private electric, or yard systems. Confirm both public and private utilities before digging.
          </p>
        </div>
      </div>
    </SimplePage>
  );
}

function VideosPage() {
  return (
    <SimplePage title="Tutorial Videos" intro="The public education library is driven by admin-managed video records so active renters can review startup, controls, thumb use, and troubleshooting.">
      <div className="grid gap-6 md:grid-cols-2">
        {[
          "How to start and shut down the mini excavator",
          "Basic controls for first-time operators",
          "Using the hydraulic thumb",
          "What to do if a track gets loose",
        ].map((title) => (
          <div key={title} className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <div className="aspect-video rounded-2xl bg-[linear-gradient(135deg,_#294534,_#4f6e59)]" />
            <h2 className="mt-5 font-display text-2xl text-soil">{title}</h2>
            <p className="mt-2 text-slate-600">Video placeholder managed through the admin portal.</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function ContactPage() {
  return (
    <SimplePage title="Contact Tonka Time Rentals" intro="Use the reservation flow for booking and this page for general questions, service-area checks, or support during an active rental.">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Contact</p>
          <p className="mt-4 text-lg text-slate-700">optimacycorp@gmail.com</p>
          <p className="mt-2 text-lg text-slate-700">(719) 555-0148</p>
          <p className="mt-2 text-slate-600">Colorado Springs and greater El Paso County</p>
        </div>
        <div className="rounded-[1.75rem] bg-field p-6 text-white shadow-card">
          <h2 className="font-display text-2xl">Active renter support</h2>
          <p className="mt-3 text-white/85">If the machine leaks, overheats, throws a track, or seems unsafe, stop operating immediately and call Tonka Time Rentals before continuing.</p>
        </div>
      </div>
    </SimplePage>
  );
}

function ReservationFlow() {
  const [draft, setDraft] = useState<ReservationDraft>({
    packageSlug: "weekend-mini-excavator-rental",
    weekendStartDate: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobsiteStreet: "",
    jobsiteCity: "Colorado Springs",
    jobsiteState: "CO",
    jobsiteZip: "",
    gateAccessNotes: "",
    surfaceAccessNotes: "",
    workDescription: "",
    ownerPermission: true,
    isPropertyOwner: true,
    damageWaiverChoice: "ACCEPTED",
  });

  return (
    <SimplePage title="Reserve a Weekend" intro="This MVP flow captures the package, weekend, delivery address, safety checklist, waiver election, and checkout handoff in one place.">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <h2 className="font-display text-2xl text-soil">Package</h2>
          <p className="mt-3 text-slate-700">Weekend Mini Excavator Rental</p>
          <p className="mt-2 text-sm text-slate-600">Delivered Friday, picked up Monday, with delivery planning and orientation included.</p>
        </div>
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <label className="block text-sm font-semibold text-slate-700">Friday weekend start</label>
          <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" type="date" value={draft.weekendStartDate} onChange={(event) => setDraft({ ...draft, weekendStartDate: event.target.value })} />
          <p className="mt-2 text-xs text-slate-500">The API enforces Friday-only starts and a 30-minute soft hold once created.</p>
        </div>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {[
          ["First name", "firstName"],
          ["Last name", "lastName"],
          ["Email", "email"],
          ["Phone", "phone"],
          ["Street address", "jobsiteStreet"],
          ["City", "jobsiteCity"],
          ["State", "jobsiteState"],
          ["ZIP", "jobsiteZip"],
        ].map(([label, key]) => (
          <label key={key} className="block">
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={draft[key as keyof ReservationDraft] as string}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="mt-6 rounded-[1.75rem] bg-white p-6 shadow-card">
        <h2 className="font-display text-2xl text-soil">Checklist highlights</h2>
        <ul className="mt-4 space-y-2 text-slate-700">
          <li>Know your boundaries and property permissions</li>
          <li>Submit Colorado 811 and wait for the locate window</li>
          <li>Confirm private utilities before digging</li>
          <li>Keep kids, pets, and bystanders away</li>
          <li>Stop and call if anything feels unsafe</li>
        </ul>
      </div>
      <div className="mt-6 rounded-[1.75rem] bg-field p-6 text-white shadow-card">
        <h2 className="font-display text-2xl">Review pricing at checkout</h2>
        <p className="mt-3 text-white/85">
          Weekend rate {currency(59500)} + core delivery {currency(10000)} + damage waiver {currency(7500)} + deposit {currency(50000)}. Final totals depend on your address and waiver election.
        </p>
      </div>
    </SimplePage>
  );
}

function AdminPage() {
  return (
    <SimplePage title="Admin Portal" intro="This is the operational side of the MVP for reservations, calendar blocks, machine assignment, videos, FAQs, and reservation follow-up.">
      <div className="grid gap-6 md:grid-cols-3">
        {[
          ["Reservations", "Track payment, agreement, 811, delivery zone, and machine assignment."],
          ["Calendar and blocks", "Manage booked weekends, admin holds, and maintenance windows."],
          ["Content and settings", "Update videos, FAQs, pricing, service areas, and admin notes."],
        ].map(([title, body]) => (
          <article key={title} className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <h2 className="font-display text-2xl text-soil">{title}</h2>
            <p className="mt-3 text-slate-700">{body}</p>
          </article>
        ))}
      </div>
    </SimplePage>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/weekend-rentals" element={<WeekendRentalsPage />} />
      <Route path="/service-area" element={<ServiceAreaPage />} />
      <Route path="/faq" element={<FAQPage />} />
      <Route path="/safety-checklist" element={<SafetyChecklistPage />} />
      <Route path="/videos" element={<VideosPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/reserve/package" element={<ReservationFlow />} />
      <Route path="/reserve/date" element={<ReservationFlow />} />
      <Route path="/reserve/delivery" element={<ReservationFlow />} />
      <Route path="/reserve/checklist" element={<ReservationFlow />} />
      <Route path="/reserve/waiver" element={<ReservationFlow />} />
      <Route path="/reserve/review" element={<ReservationFlow />} />
      <Route path="/reserve/payment" element={<ReservationFlow />} />
      <Route path="/reserve/sign" element={<ReservationFlow />} />
      <Route path="/reserve/confirmation" element={<ReservationFlow />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/reservations" element={<AdminPage />} />
      <Route path="/admin/calendar" element={<AdminPage />} />
      <Route path="/admin/machines" element={<AdminPage />} />
      <Route path="/admin/videos" element={<AdminPage />} />
      <Route path="/admin/faq" element={<AdminPage />} />
      <Route path="/admin/settings" element={<AdminPage />} />
    </Routes>
  );
}
