import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";

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
  isPropertyOwner: boolean;
  ownerPermission: boolean;
  deliveryZone?: string;
  damageWaiverChoice: "ACCEPTED" | "DECLINED";
  colorado811Ticket: string;
  plannedWorkCategory: string;
  plannedWorkDescription: string;
  checklistCompleted: boolean;
  checklist: Record<string, boolean>;
  tutorialAcknowledgement: Record<string, boolean>;
  waiverAcknowledged: boolean;
};

type ReservationSummary = {
  publicId?: string;
  weekendStartDate?: string;
  weekendEndDate?: string;
  deliveryZone?: string;
  deliveryFeeCents?: number;
  rentalSubtotalCents?: number;
  damageWaiverFeeCents?: number;
  depositCents?: number;
  totalDueCents?: number;
  status?: string;
};

type AvailabilityResponse = {
  weekendStartDate: string;
  weekendEndDate: string;
  available: boolean;
  availableMachineCount: number;
  reason: string | null;
};

const heroGraphic = "/images/tonka-hero-landscape.png";
const promoPoster = "/images/tonka-promo-poster.png";
const draftStorageKey = "tonka-time-reservation-draft";

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

const reservationSteps = [
  { path: "/reserve/package", label: "Package" },
  { path: "/reserve/date", label: "Date" },
  { path: "/reserve/delivery", label: "Delivery" },
  { path: "/reserve/checklist", label: "Checklist" },
  { path: "/reserve/waiver", label: "Waiver" },
  { path: "/reserve/review", label: "Review" },
  { path: "/reserve/payment", label: "Payment" },
  { path: "/reserve/sign", label: "Sign" },
  { path: "/reserve/confirmation", label: "Confirmation" },
];

const requiredChecklistKeys = [
  "knowsBoundaries",
  "understandsFenceNotBoundary",
  "hasOwnerPermission",
  "notDiggingNeighborProperty",
  "notDiggingPublicROWWithoutPermit",
  "submitted811OrWillBeforeDigging",
  "willWaitForLocateWindow",
  "understandsPrivateUtilities",
  "willAvoidUtilityToleranceZone",
  "willNotUndermineStructures",
  "willKeepPeoplePetsAway",
  "willStopIfUnsafe",
];

const tutorialKeys = [
  "receivedQuickStartGuide",
  "understandsBasicControls",
  "knowsEmergencyShutdown",
  "understandsTipRisk",
  "willWatchTutorialVideos",
  "willCallIfUnsure",
];

const projectCategories = [
  "Drainage",
  "Trenching",
  "Fence line",
  "Landscaping",
  "Stump/root cleanup",
  "Culvert work",
  "Small retaining wall prep",
  "Driveway/parking prep",
  "Other",
];

const defaultDraft: ReservationDraft = {
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
  isPropertyOwner: true,
  ownerPermission: true,
  deliveryZone: undefined,
  damageWaiverChoice: "ACCEPTED",
  colorado811Ticket: "",
  plannedWorkCategory: "Drainage",
  plannedWorkDescription: "",
  checklistCompleted: false,
  checklist: Object.fromEntries(requiredChecklistKeys.map((key) => [key, false])),
  tutorialAcknowledgement: Object.fromEntries(tutorialKeys.map((key) => [key, false])),
  waiverAcknowledged: false,
};

function currency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sky text-slate-900">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-sky/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img src={heroGraphic} alt="Tonka Time Rentals branding" className="h-12 w-16 rounded-2xl object-cover object-left shadow-card" />
            <div>
              <p className="font-display text-2xl font-bold text-soil">Tonka Time Rentals</p>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Weekend mini excavator rentals</p>
            </div>
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
          <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div>
              <p className="mb-4 inline-flex rounded-full bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-field shadow-card">
                Weekend-only rentals for homeowners
              </p>
              <h1 className="max-w-3xl font-display text-5xl font-bold leading-none text-soil md:text-6xl">
                DIY-friendly mini excavator weekends for real backyard projects
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-slate-700">
                Delivered Friday. Picked up Monday. Compact 1.8-ton machine with hydraulic thumb, homeowner safety checklist, and quick-start support for projects across El Paso County.
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
            <div className="relative">
              <div className="absolute -inset-4 rounded-[2.5rem] bg-[linear-gradient(135deg,_rgba(223,107,55,0.18),_rgba(41,69,52,0.15))] blur-2xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 p-3 shadow-card">
                <img src={heroGraphic} alt="Tonka Time Rentals weekend mini excavator hero graphic" className="w-full rounded-[1.5rem] object-cover" />
                <div className="grid gap-3 p-4 md:grid-cols-3">
                  {[
                    ["Weekend package", `Starting at ${currency(59500)}`],
                    ["Service area", "Colorado Springs and El Paso County"],
                    ["Included", "Quick tutorial plus safety checklist"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-slate-950 px-4 py-4 text-white">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/60">{label}</p>
                      <p className="mt-2 text-sm font-semibold leading-6">{value}</p>
                    </div>
                  ))}
                </div>
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
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-card">
          <img src={promoPoster} alt="Tonka Time Rentals branded weekend mini excavator poster" className="h-full w-full object-cover" />
        </div>
        <div className="grid gap-6">
          <div className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-card">
            <p className="text-sm uppercase tracking-[0.2em] text-white/60">What you get</p>
            <h2 className="mt-2 font-display text-3xl">A homeowner-ready weekend package</h2>
            <p className="mt-4 text-white/80">
              The same branded offer shown in your graphic is now part of the site experience: delivery availability, hydraulic thumb support, homeowner-friendly positioning, and clear reserve-online calls to action.
            </p>
          </div>
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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<ReservationDraft>(() => {
    const stored = localStorage.getItem(draftStorageKey);
    return stored ? { ...defaultDraft, ...JSON.parse(stored) } : defaultDraft;
  });
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reservationSummary, setReservationSummary] = useState<ReservationSummary | null>(null);
  const [paymentUrl, setPaymentUrl] = useState("");
  const currentStepIndex = reservationSteps.findIndex((step) => step.path === location.pathname);

  useEffect(() => {
    localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (location.pathname === "/reserve/payment" && draft.publicId) {
      void createCheckoutSession();
    }
    if ((location.pathname === "/reserve/sign" || location.pathname === "/reserve/confirmation") && draft.publicId) {
      void loadReservationSummary(draft.publicId);
    }
  }, [location.pathname, draft.publicId]);

  const pricing = useMemo(() => {
    const deliveryFeeCents = draft.deliveryZone === "CORE" ? 10000 : 15000;
    const damageWaiverFeeCents = draft.damageWaiverChoice === "ACCEPTED" ? 7500 : 0;
    const rentalSubtotalCents = 59500;
    const depositCents = 50000;
    return {
      deliveryFeeCents,
      damageWaiverFeeCents,
      rentalSubtotalCents,
      depositCents,
      totalDueCents: rentalSubtotalCents + deliveryFeeCents + damageWaiverFeeCents + depositCents,
    };
  }, [draft.deliveryZone, draft.damageWaiverChoice]);

  async function checkAvailability(startDate: string) {
    if (!startDate) {
      setAvailability(null);
      setAvailabilityMessage("");
      return;
    }

    setAvailabilityLoading(true);
    setAvailabilityMessage("");
    try {
      const response = await fetch(`/api/availability?startDate=${startDate}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not check availability.");
      }
      setAvailability(data);
      setAvailabilityMessage(data.available ? `${data.availableMachineCount} machine(s) are available for this weekend.` : data.reason ?? "This weekend is unavailable.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not check availability.";
      setAvailability(null);
      setAvailabilityMessage(message);
    } finally {
      setAvailabilityLoading(false);
    }
  }

  async function saveReservation() {
    const payload = {
      packageSlug: draft.packageSlug,
      weekendStartDate: draft.weekendStartDate,
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email,
      phone: draft.phone,
      jobsiteStreet: draft.jobsiteStreet,
      jobsiteCity: draft.jobsiteCity,
      jobsiteState: draft.jobsiteState,
      jobsiteZip: draft.jobsiteZip,
      gateAccessNotes: draft.gateAccessNotes,
      surfaceAccessNotes: draft.surfaceAccessNotes,
      workDescription: `${draft.plannedWorkCategory}: ${draft.plannedWorkDescription}`.trim(),
      isPropertyOwner: draft.isPropertyOwner,
      ownerPermission: draft.ownerPermission,
      damageWaiverChoice: draft.damageWaiverChoice,
      colorado811Ticket: draft.colorado811Ticket || undefined,
      checklistCompleted: draft.checklistCompleted,
    };

    const response = await fetch(draft.publicId ? `/api/reservations/${draft.publicId}` : "/api/reservations", {
      method: draft.publicId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Could not save reservation.");
    }
    if (!draft.publicId && data.publicId) {
      setDraft((current) => ({ ...current, publicId: data.publicId, deliveryZone: data.deliveryZone }));
    } else if (data.deliveryZone) {
      setDraft((current) => ({ ...current, deliveryZone: data.deliveryZone }));
    }
    setReservationSummary(data);
    return data;
  }

  async function createCheckoutSession() {
    if (!draft.publicId || paymentUrl) {
      return;
    }

    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationPublicId: draft.publicId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not create checkout session.");
      }
      setPaymentUrl(data.checkoutUrl);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create checkout session.");
    }
  }

  async function loadReservationSummary(publicId: string) {
    const response = await fetch(`/api/reservations/${publicId}`);
    const data = await response.json();
    if (response.ok) {
      setReservationSummary(data);
    }
  }

  function updateField<Key extends keyof ReservationDraft>(field: Key, value: ReservationDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateChecklistValue(group: "checklist" | "tutorialAcknowledgement", key: string, value: boolean) {
    setDraft((current) => ({
      ...current,
      [group]: {
        ...current[group],
        [key]: value,
      },
    }));
  }

  function validateCurrentStep() {
    switch (location.pathname) {
      case "/reserve/package":
        return true;
      case "/reserve/date":
        if (!draft.weekendStartDate) {
          setErrorMessage("Choose a Friday start date to continue.");
          return false;
        }
        if (!availability?.available) {
          setErrorMessage("Select an available Friday weekend before continuing.");
          return false;
        }
        return true;
      case "/reserve/delivery":
        if (!draft.firstName || !draft.lastName || !draft.email || !draft.phone || !draft.jobsiteStreet || !draft.jobsiteCity || !draft.jobsiteState || !draft.jobsiteZip) {
          setErrorMessage("Complete the required delivery and contact fields.");
          return false;
        }
        return true;
      case "/reserve/checklist": {
        const allChecklistAccepted = requiredChecklistKeys.every((key) => draft.checklist[key]);
        const allTutorialAccepted = tutorialKeys.every((key) => draft.tutorialAcknowledgement[key]);
        if (!allChecklistAccepted || !allTutorialAccepted || !draft.plannedWorkCategory || !draft.plannedWorkDescription) {
          setErrorMessage("Finish the checklist, tutorial acknowledgements, and project description.");
          return false;
        }
        return true;
      }
      case "/reserve/waiver":
        if (!draft.waiverAcknowledged) {
          setErrorMessage("Acknowledge the Limited Damage Waiver wording to continue.");
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async function goNext() {
    setErrorMessage("");
    if (!validateCurrentStep()) {
      return;
    }

    if (location.pathname === "/reserve/checklist") {
      updateField("checklistCompleted", true);
    }

    if (location.pathname === "/reserve/review") {
      try {
        setSaving(true);
        const saved = await saveReservation();
        if (!draft.publicId && saved.publicId) {
          navigate(`/reserve/payment?reservation=${saved.publicId}`);
          return;
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not save reservation.");
        return;
      } finally {
        setSaving(false);
      }
    }

    const nextStep = reservationSteps[currentStepIndex + 1];
    if (nextStep) {
      navigate(nextStep.path);
    }
  }

  function goBack() {
    const previousStep = reservationSteps[currentStepIndex - 1];
    if (previousStep) {
      navigate(previousStep.path);
    }
  }

  function resetDraft() {
    localStorage.removeItem(draftStorageKey);
    setDraft(defaultDraft);
    setReservationSummary(null);
    setPaymentUrl("");
    navigate("/reserve/package");
  }

  const derivedWeekendEnd = draft.weekendStartDate ? getWeekendEnd(draft.weekendStartDate) : "";
  const reservationIdFromUrl = searchParams.get("reservation") ?? draft.publicId;

  return (
    <SimplePage title="Reserve a Weekend" intro="This MVP flow now walks you through the actual reservation steps: package, Friday availability, delivery details, homeowner checklist, waiver election, review, payment handoff, and post-payment next steps.">
      <div className="grid gap-8 lg:grid-cols-[0.32fr_0.68fr]">
        <aside className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-card">
          <p className="text-xs uppercase tracking-[0.22em] text-white/55">Reservation progress</p>
          <div className="mt-5 space-y-3">
            {reservationSteps.map((step, index) => {
              const active = step.path === location.pathname;
              const complete = currentStepIndex > index;
              return (
                <button
                  key={step.path}
                  type="button"
                  onClick={() => navigate(step.path)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${active ? "bg-white text-slate-950" : "bg-white/5 text-white/80 hover:bg-white/10"} `}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${complete || active ? "bg-ember text-white" : "bg-white/10 text-white/60"}`}>
                    {index + 1}
                  </span>
                  <span className="font-medium">{step.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 rounded-2xl bg-white/5 p-4 text-sm text-white/75">
            <p className="font-semibold text-white">Current draft</p>
            <p className="mt-2">Reservation ID: {draft.publicId ?? "Not created yet"}</p>
            <p className="mt-1">Weekend: {draft.weekendStartDate || "Not selected"}</p>
            <p className="mt-1">Zone: {draft.deliveryZone ?? "Pending address check"}</p>
          </div>
        </aside>

        <section className="space-y-6">
          {location.pathname === "/reserve/package" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 1</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Weekend Mini Excavator Rental</h2>
              <p className="mt-4 max-w-3xl text-slate-700">
                One clear MVP package: Friday delivery, Monday pickup, local planning support, and a homeowner-first workflow that keeps the weekend booking simple.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {[
                  "1.8-ton compact mini excavator",
                  "Hydraulic thumb and expandable tracks",
                  "DIY-friendly delivery model",
                  "Safety checklist and quick tutorial included",
                ].map((item) => (
                  <div key={item} className="rounded-2xl bg-sky px-4 py-4 text-sm font-medium text-slate-700">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {location.pathname === "/reserve/date" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 2</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Choose your Friday weekend</h2>
              <label className="mt-6 block">
                <span className="text-sm font-semibold text-slate-700">Friday start date</span>
                <input
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3"
                  type="date"
                  value={draft.weekendStartDate}
                  onChange={(event) => {
                    updateField("weekendStartDate", event.target.value);
                    void checkAvailability(event.target.value);
                  }}
                />
              </label>
              <p className="mt-3 text-sm text-slate-500">Only Friday starts are accepted. The system holds your chosen weekend for 30 minutes once the reservation is saved.</p>
              <div className="mt-5 rounded-2xl bg-sky p-4">
                {availabilityLoading ? (
                  <p className="text-sm text-slate-600">Checking availability...</p>
                ) : (
                  <p className={`text-sm font-medium ${availability?.available ? "text-field" : "text-soil"}`}>{availabilityMessage || "Choose a Friday date to check availability."}</p>
                )}
                {availability && (
                  <p className="mt-2 text-sm text-slate-600">
                    Weekend: {availability.weekendStartDate} to {availability.weekendEndDate}
                  </p>
                )}
              </div>
            </div>
          )}

          {location.pathname === "/reserve/delivery" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 3</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Delivery and jobsite details</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
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
                      onChange={(event) => updateField(key as keyof ReservationDraft, event.target.value as never)}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-5 grid gap-5">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Gate and access notes</span>
                  <textarea className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" value={draft.gateAccessNotes} onChange={(event) => updateField("gateAccessNotes", event.target.value)} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Surface and access notes</span>
                  <textarea className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" value={draft.surfaceAccessNotes} onChange={(event) => updateField("surfaceAccessNotes", event.target.value)} />
                </label>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl bg-sky px-4 py-4">
                  <input type="checkbox" checked={draft.isPropertyOwner} onChange={(event) => updateField("isPropertyOwner", event.target.checked)} />
                  <span className="text-sm font-medium text-slate-700">I am the property owner</span>
                </label>
                <label className="flex items-center gap-3 rounded-2xl bg-sky px-4 py-4">
                  <input type="checkbox" checked={draft.ownerPermission} onChange={(event) => updateField("ownerPermission", event.target.checked)} />
                  <span className="text-sm font-medium text-slate-700">I have permission to dig at this property</span>
                </label>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/checklist" && (
            <div className="space-y-6">
              <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 4</p>
                <h2 className="mt-2 font-display text-3xl text-soil">Homeowner dig checklist</h2>
                <div className="mt-5 grid gap-3">
                  {requiredChecklistKeys.map((key) => (
                    <label key={key} className="flex items-start gap-3 rounded-2xl bg-sky px-4 py-4">
                      <input type="checkbox" className="mt-1" checked={draft.checklist[key]} onChange={(event) => updateChecklistValue("checklist", key, event.target.checked)} />
                      <span className="text-sm text-slate-700">{checklistLabel(key)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
                <h3 className="font-display text-2xl text-soil">Project details</h3>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Colorado 811 ticket number</span>
                    <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" value={draft.colorado811Ticket} onChange={(event) => updateField("colorado811Ticket", event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Planned work category</span>
                    <select className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3" value={draft.plannedWorkCategory} onChange={(event) => updateField("plannedWorkCategory", event.target.value)}>
                      {projectCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mt-5 block">
                  <span className="text-sm font-semibold text-slate-700">Describe the work area and project</span>
                  <textarea className="mt-2 min-h-32 w-full rounded-2xl border border-slate-200 px-4 py-3" value={draft.plannedWorkDescription} onChange={(event) => updateField("plannedWorkDescription", event.target.value)} />
                </label>
              </div>
              <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
                <h3 className="font-display text-2xl text-soil">Tutorial acknowledgement</h3>
                <div className="mt-5 grid gap-3">
                  {tutorialKeys.map((key) => (
                    <label key={key} className="flex items-start gap-3 rounded-2xl bg-sky px-4 py-4">
                      <input type="checkbox" className="mt-1" checked={draft.tutorialAcknowledgement[key]} onChange={(event) => updateChecklistValue("tutorialAcknowledgement", key, event.target.checked)} />
                      <span className="text-sm text-slate-700">{tutorialLabel(key)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/waiver" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 5</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Limited Damage Waiver</h2>
              <p className="mt-4 text-slate-700">
                Limited Damage Waiver: This is not insurance. It may reduce certain accidental equipment damage charges, subject to the signed agreement, exclusions, prohibited-use rules, and deductible terms.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => updateField("damageWaiverChoice", "ACCEPTED")}
                  className={`rounded-[1.75rem] border px-5 py-5 text-left transition ${draft.damageWaiverChoice === "ACCEPTED" ? "border-ember bg-ember text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  <p className="font-display text-2xl">Accept</p>
                  <p className="mt-2 text-sm">Adds {currency(7500)} to the weekend total.</p>
                </button>
                <button
                  type="button"
                  onClick={() => updateField("damageWaiverChoice", "DECLINED")}
                  className={`rounded-[1.75rem] border px-5 py-5 text-left transition ${draft.damageWaiverChoice === "DECLINED" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  <p className="font-display text-2xl">Decline</p>
                  <p className="mt-2 text-sm">Manual review flags may be added for declined waivers.</p>
                </button>
              </div>
              <label className="mt-6 flex items-start gap-3 rounded-2xl bg-sky px-4 py-4">
                <input type="checkbox" className="mt-1" checked={draft.waiverAcknowledged} onChange={(event) => updateField("waiverAcknowledged", event.target.checked)} />
                <span className="text-sm text-slate-700">
                  I understand the Limited Damage Waiver is not insurance and does not cover theft, rollover, submerged equipment, utility strikes, misuse, unauthorized operators, transport damage, prohibited uses, or third-party property damage.
                </span>
              </label>
            </div>
          )}

          {location.pathname === "/reserve/review" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 6</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Reservation review</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <SummaryCard title="Weekend" lines={[draft.weekendStartDate ? `Friday ${draft.weekendStartDate}` : "Not selected", derivedWeekendEnd ? `Monday ${derivedWeekendEnd}` : ""]} />
                <SummaryCard title="Delivery" lines={[draft.jobsiteStreet, `${draft.jobsiteCity}, ${draft.jobsiteState} ${draft.jobsiteZip}`, `Zone: ${draft.deliveryZone ?? "Will be classified on save"}`]} />
                <SummaryCard title="Package" lines={["Weekend Mini Excavator Rental", "Machine and attachments subject to availability"]} />
                <SummaryCard title="Checklist" lines={[draft.checklistCompleted ? "Completed" : "Will be marked completed on save", draft.colorado811Ticket ? `811 ticket: ${draft.colorado811Ticket}` : "811 ticket: still optional at booking"]} />
              </div>
              <div className="mt-6 rounded-[1.75rem] bg-slate-950 p-6 text-white">
                <p className="text-sm uppercase tracking-[0.2em] text-white/60">Estimated due today</p>
                <div className="mt-4 grid gap-3 text-sm">
                  <div className="flex items-center justify-between"><span>Weekend rental</span><span>{currency(pricing.rentalSubtotalCents)}</span></div>
                  <div className="flex items-center justify-between"><span>Delivery</span><span>{currency(pricing.deliveryFeeCents)}</span></div>
                  <div className="flex items-center justify-between"><span>Damage waiver</span><span>{currency(pricing.damageWaiverFeeCents)}</span></div>
                  <div className="flex items-center justify-between"><span>Deposit</span><span>{currency(pricing.depositCents)}</span></div>
                  <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-3 font-semibold"><span>Total due today</span><span>{currency(pricing.totalDueCents)}</span></div>
                </div>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/payment" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 7</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Payment handoff</h2>
              <p className="mt-4 text-slate-700">
                This sprint wires the reservation into the backend and the Stripe checkout placeholder. The live Stripe session integration is the next sprint item.
              </p>
              <div className="mt-6 rounded-2xl bg-sky p-5">
                <p className="text-sm font-medium text-slate-700">Reservation ID: {reservationIdFromUrl ?? "Missing reservation ID"}</p>
                <p className="mt-2 text-sm text-slate-600">Checkout placeholder URL: {paymentUrl || "Generating..."}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {paymentUrl && (
                  <button type="button" onClick={() => navigate(`/reserve/sign?reservation=${reservationIdFromUrl}`)} className="rounded-full bg-soil px-6 py-3 font-semibold text-white">
                    Continue to signing
                  </button>
                )}
                <button type="button" onClick={() => navigate("/reserve/review")} className="rounded-full border border-soil px-6 py-3 font-semibold text-soil">
                  Back to review
                </button>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/sign" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 8</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Agreement signing</h2>
              <p className="mt-4 text-slate-700">
                This sprint keeps the signing step visible in the customer flow and loads the saved reservation summary. Live DocuSeal embedded signing is the next implementation sprint.
              </p>
              <div className="mt-6 rounded-2xl bg-field p-5 text-white">
                <p>Reservation: {reservationSummary?.publicId ?? reservationIdFromUrl ?? "Loading..."}</p>
                <p className="mt-2">Status: {reservationSummary?.status ?? "Draft / pending payment"}</p>
              </div>
              <div className="mt-6">
                <button type="button" onClick={() => navigate(`/reserve/confirmation?reservation=${reservationIdFromUrl}`)} className="rounded-full bg-soil px-6 py-3 font-semibold text-white">
                  Continue to confirmation
                </button>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/confirmation" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 9</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Confirmation summary</h2>
              <p className="mt-4 text-slate-700">
                Your reservation flow is now saved through review and wired into the backend APIs. Payment and DocuSeal are still placeholder handoffs, but the customer-facing reservation journey is now live.
              </p>
              <div className="mt-6 rounded-[1.75rem] bg-sky p-6">
                <p className="font-semibold text-slate-700">Reservation ID: {reservationSummary?.publicId ?? reservationIdFromUrl ?? "Pending"}</p>
                <p className="mt-2 text-sm text-slate-600">Weekend: {reservationSummary?.weekendStartDate?.slice(0, 10) ?? draft.weekendStartDate} to {reservationSummary?.weekendEndDate?.slice(0, 10) ?? derivedWeekendEnd}</p>
                <p className="mt-2 text-sm text-slate-600">Delivery zone: {reservationSummary?.deliveryZone ?? draft.deliveryZone ?? "Pending"}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={resetDraft} className="rounded-full bg-soil px-6 py-3 font-semibold text-white">
                  Start another reservation
                </button>
                <NavLink to="/" className="rounded-full border border-soil px-6 py-3 font-semibold text-soil">
                  Back to homepage
                </NavLink>
              </div>
            </div>
          )}

          {errorMessage && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}

          <div className="flex flex-wrap items-center gap-3">
            {currentStepIndex > 0 && location.pathname !== "/reserve/confirmation" && (
              <button type="button" onClick={goBack} className="rounded-full border border-soil px-6 py-3 font-semibold text-soil">
                Back
              </button>
            )}
            {!["/reserve/payment", "/reserve/sign", "/reserve/confirmation"].includes(location.pathname) && (
              <button type="button" onClick={() => void goNext()} disabled={saving} className="rounded-full bg-soil px-6 py-3 font-semibold text-white disabled:opacity-60">
                {saving ? "Saving..." : location.pathname === "/reserve/review" ? "Save and continue" : "Continue"}
              </button>
            )}
          </div>
        </section>
      </div>
    </SimplePage>
  );
}

function SummaryCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-[1.5rem] bg-sky p-5">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <div className="mt-3 space-y-1 text-sm text-slate-700">
        {lines.filter(Boolean).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function checklistLabel(key: string) {
  const labels: Record<string, string> = {
    knowsBoundaries: "I know my property boundaries.",
    understandsFenceNotBoundary: "I understand fences may not be property lines.",
    hasOwnerPermission: "I have permission to dig.",
    notDiggingNeighborProperty: "I will not dig on neighboring property.",
    notDiggingPublicROWWithoutPermit: "I will not dig in a public right-of-way without permit or permission.",
    submitted811OrWillBeforeDigging: "I submitted or will submit an 811 request before digging.",
    willWaitForLocateWindow: "I will wait for the locate window to pass before digging.",
    understandsPrivateUtilities: "I understand private utilities may not be marked by 811.",
    willAvoidUtilityToleranceZone: "I will avoid utility tolerance zones unless hand digging is required.",
    willNotUndermineStructures: "I will not undermine structures, slabs, or retaining areas without a plan.",
    willKeepPeoplePetsAway: "I will keep children, pets, vehicles, and bystanders away.",
    willStopIfUnsafe: "I will stop and call Tonka Time Rentals if the machine leaks, overheats, throws a track, or seems unsafe.",
  };
  return labels[key] ?? key;
}

function tutorialLabel(key: string) {
  const labels: Record<string, string> = {
    receivedQuickStartGuide: "I received the quick start guide.",
    understandsBasicControls: "I understand the basic controls.",
    knowsEmergencyShutdown: "I know how to perform an emergency shutdown.",
    understandsTipRisk: "I understand rollover and tip risk.",
    willWatchTutorialVideos: "I will watch the tutorial videos before operating.",
    willCallIfUnsure: "I will call if I am unsure about safe operation.",
  };
  return labels[key] ?? key;
}

function getWeekendEnd(startDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  date.setDate(date.getDate() + 3);
  return date.toISOString().slice(0, 10);
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
