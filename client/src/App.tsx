import { useEffect, useMemo, useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
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
  email?: string;
  weekendStartDate?: string;
  weekendEndDate?: string;
  deliveryZone?: string;
  deliveryFeeCents?: number;
  rentalSubtotalCents?: number;
  damageWaiverFeeCents?: number;
  depositCents?: number;
  totalDueCents?: number;
  status?: string;
  signingStatus?: string;
  docusealStatus?: string;
  signedDocumentUrl?: string | null;
};

type CheckoutResponse = {
  checkoutUrl?: string | null;
  clientSecret?: string | null;
  publishableKey?: string | null;
  sessionId?: string | null;
  mode: "live" | "placeholder" | "fake";
  message: string;
  reservation?: ReservationSummary | null;
};

type CheckoutSessionStatusResponse = {
  sessionId: string;
  status: "open" | "complete" | "expired" | null;
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | null;
  reservationPublicId: string | null;
};

type OpenSignSigningResponse = {
  mode: "live" | "placeholder";
  reservationPublicId?: string;
  sessionId?: string | null;
  embedUrl?: string | null;
  status?: string | null;
  signedDocumentUrl?: string | null;
  message?: string;
};

type AvailabilityResponse = {
  weekendStartDate: string;
  weekendEndDate: string;
  available: boolean;
  availableMachineCount: number;
  reason: string | null;
};

type FridayOption = AvailabilityResponse & {
  label: string;
};

type AuthUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: "CUSTOMER" | "ADMIN";
};

type AuthResponse = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

type AccountReservation = ReservationSummary & {
  id: string;
  email?: string;
  phone?: string;
  paymentStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  internalFlags?: Record<string, unknown> | null;
};

type NotificationItem = {
  id: string;
  channel: "EMAIL" | "SMS" | "SYSTEM";
  destination: string;
  subject?: string | null;
  message: string;
  status: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
  createdAt: string;
};

const heroGraphic = "/images/tonka-hero-landscape.png";
const promoPoster = "/images/tonka-promo-poster.png";
const draftStorageKey = "tonka-time-reservation-draft";
const authStorageKey = "tonka-time-auth-session";

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
  ["Can I move the excavator to another property or haul it on my own trailer?", "No. The machine is approved only for the listed jobsite, geofence monitoring may be used, and customer transport or relocation requires prior written approval from Tonka Time Rentals."],
];

const reservationSteps = [
  { path: "/reserve/package", label: "Package" },
  { path: "/reserve/date", label: "Date" },
  { path: "/reserve/delivery", label: "Delivery" },
  { path: "/reserve/checklist", label: "Checklist" },
  { path: "/reserve/waiver", label: "Waiver" },
  { path: "/reserve/review", label: "Review" },
  { path: "/reserve/sign", label: "Sign" },
  { path: "/reserve/payment", label: "Payment" },
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
  "understandsEquipmentMayBeTracked",
  "consentsToLocationMonitoring",
  "willUseOnlyAtApprovedJobsite",
  "willNotMoveWithoutApproval",
  "willNotTransportWithoutApproval",
  "willNotTamperWithTrackingDevice",
  "understandsGeofenceBreachConsequences",
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
              ["/account", "Account"],
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
          Equipment use is limited to the approved jobsite unless Tonka Time Rentals gives prior written approval for relocation or customer transport.
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
                {["Local delivery included in planning", "Quick tutorial before you dig", "Hydraulic thumb and expandable tracks", "811 reminders, approved-jobsite use, and geofence notice"].map((item) => (
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
              ["2. Confirm delivery", "Tell us about the address, access, work area, property permissions, and the one approved jobsite for the rental."],
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
          We use address details, access notes, and delivery-zone rules to decide whether your job is in the core area, extended area, or needs manual review before confirmation. The approved jobsite address also becomes the location limit for the rental unless Tonka Time Rentals approves a different use in writing.
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
            <li>Use the machine only at the approved jobsite unless Tonka Time Rentals approves relocation in writing</li>
            <li>Do not load, haul, or tow the excavator on your own trailer without written approval</li>
            <li>Do not remove, block, or tamper with any tracker, lock, key, or security device</li>
            <li>Keep kids, pets, and bystanders away</li>
            <li>Stop if the machine leaks, overheats, or feels unsafe</li>
          </ul>
        </div>
        <div className="rounded-[1.75rem] bg-ember p-6 text-white shadow-card">
          <h2 className="font-display text-2xl">811 reminder</h2>
          <p className="mt-4 text-white/90">
            Public utility markings may not include irrigation, septic, propane, private electric, or yard systems. Confirm both public and private utilities before digging.
          </p>
          <p className="mt-4 text-white/90">
            Tonka Time Rentals may use GPS, telematics, geofence, or anti-theft tools for delivery, recovery, theft prevention, support, and agreement enforcement during the rental period.
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

function StripeEmbeddedCheckoutCard({
  clientSecret,
  publishableKey,
  reservationPublicId,
}: {
  clientSecret: string;
  publishableKey: string;
  reservationPublicId: string;
}) {
  const navigate = useNavigate();
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  const options = useMemo(
    () => ({
      clientSecret,
      onComplete: () => {
        navigate(`/reserve/sign?reservation=${reservationPublicId}`);
      },
    }),
    [clientSecret, navigate, reservationPublicId],
  );

  return (
    <EmbeddedCheckoutProvider key={clientSecret} stripe={stripePromise} options={options}>
      <div className="overflow-hidden rounded-[1.5rem] border border-black/5 bg-white shadow-card">
        <EmbeddedCheckout />
      </div>
    </EmbeddedCheckoutProvider>
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
  const [fridayOptions, setFridayOptions] = useState<FridayOption[]>([]);
  const [fridayOptionsLoading, setFridayOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reservationSummary, setReservationSummary] = useState<ReservationSummary | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState("");
  const [checkoutPublishableKey, setCheckoutPublishableKey] = useState("");
  const [checkoutMode, setCheckoutMode] = useState<"live" | "placeholder" | "fake" | "">("");
  const [paymentStatusMessage, setPaymentStatusMessage] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [signNowMode, setSignNowMode] = useState<"live" | "placeholder" | "">("");
  const [signNowEmbedUrl, setSignNowEmbedUrl] = useState("");
  const [signNowLoading, setSignNowLoading] = useState(false);
  const [signNowMessage, setSignNowMessage] = useState("");
  const currentStepIndex = reservationSteps.findIndex((step) => step.path === location.pathname);

  useEffect(() => {
    localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (location.pathname === "/reserve/payment" && draft.publicId && !searchParams.get("session_id")) {
      void createCheckoutSession();
    }
    if ((location.pathname === "/reserve/sign" || location.pathname === "/reserve/confirmation") && draft.publicId) {
      void loadReservationSummary(draft.publicId);
    }
    if (location.pathname === "/reserve/sign" && draft.publicId) {
      void ensureSignNowSigningSession(draft.publicId);
    }
  }, [location.pathname, draft.publicId, searchParams]);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (location.pathname === "/reserve/payment" && sessionId) {
      void loadCheckoutSessionStatus(sessionId);
    }
  }, [location.pathname, searchParams]);

  useEffect(() => {
    if (location.pathname === "/reserve/date") {
      void loadFridayOptions();
      return;
    }

    setFridayOptions([]);
    setFridayOptionsLoading(false);
  }, [location.pathname]);

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

  async function loadFridayOptions() {
    const upcomingFridays = getUpcomingFridays(10);
    setFridayOptionsLoading(true);

    try {
      const results = await Promise.all(
        upcomingFridays.map(async (startDate) => {
          try {
            const data = await requestJson<AvailabilityResponse>(`/api/availability?startDate=${startDate}`);
            return {
              ...data,
              label: formatFridayLabel(data.weekendStartDate),
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Could not check availability.";
            return {
              weekendStartDate: startDate,
              weekendEndDate: getWeekendEnd(startDate),
              available: false,
              availableMachineCount: 0,
              reason: message,
              label: formatFridayLabel(startDate),
            } satisfies FridayOption;
          }
        }),
      );

      setFridayOptions(results);

      const selected = results.find((option) => option.weekendStartDate === draft.weekendStartDate) ?? null;
      if (selected) {
        setAvailability(selected);
        setAvailabilityMessage(selected.available ? `${selected.availableMachineCount} machine(s) are available for this weekend.` : selected.reason ?? "This weekend is unavailable.");
        if (!selected.available) {
          setDraft((current) => ({ ...current, weekendStartDate: "" }));
        }
      } else if (!draft.weekendStartDate) {
        const firstAvailable = results.find((option) => option.available) ?? null;
        setAvailability(firstAvailable);
        setAvailabilityMessage(firstAvailable ? `${firstAvailable.availableMachineCount} machine(s) are available for this weekend.` : "No Friday weekends are currently available.");
      }
    } finally {
      setFridayOptionsLoading(false);
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

    const data = await requestJson<ReservationSummary & { publicId?: string; deliveryZone?: string }>(draft.publicId ? `/api/reservations/${draft.publicId}` : "/api/reservations", {
      method: draft.publicId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!draft.publicId && data.publicId) {
      setDraft((current) => ({ ...current, publicId: data.publicId, deliveryZone: data.deliveryZone }));
    } else if (data.deliveryZone) {
      setDraft((current) => ({ ...current, deliveryZone: data.deliveryZone }));
    }
    setReservationSummary(data);
    return data;
  }

  async function createCheckoutSession() {
    if (!draft.publicId || checkoutClientSecret || checkoutMode === "placeholder") {
      return;
    }

    try {
      setPaymentLoading(true);
      setPaymentStatusMessage("");
      const data = await requestJson<CheckoutResponse>("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationPublicId: draft.publicId }),
      });
      setCheckoutMode(data.mode);
      setPaymentStatusMessage(data.message);
      if (data.reservation) {
        setReservationSummary(normalizeReservationSummary(data.reservation));
      }
      if (data.mode === "fake") {
        return;
      }
      if (data.mode === "live" && data.clientSecret && data.publishableKey) {
        setCheckoutClientSecret(data.clientSecret);
        setCheckoutPublishableKey(data.publishableKey);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create checkout session.");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function loadCheckoutSessionStatus(sessionId: string) {
    try {
      setPaymentLoading(true);
      const data = await requestJson<CheckoutSessionStatusResponse>(`/api/stripe/checkout-session-status?sessionId=${encodeURIComponent(sessionId)}`);
      if (data.status === "complete" && data.paymentStatus === "paid") {
        navigate(`/reserve/confirmation?reservation=${reservationIdFromUrl ?? draft.publicId}`);
        return;
      }

      if (data.status === "open") {
        setPaymentStatusMessage("Your Stripe session is still open. Finish payment below to continue.");
        return;
      }

      if (data.status === "expired") {
        setPaymentStatusMessage("That payment session expired. Refresh the page to generate a new one.");
      }
    } catch (error) {
      setPaymentStatusMessage(error instanceof Error ? error.message : "Could not load the Stripe session status.");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function loadReservationSummary(publicId: string) {
    try {
      const data = normalizeReservationSummary(await requestJson<ReservationSummary>(`/api/reservations/${publicId}`));
      setReservationSummary(data);
    } catch {
      // Keep existing UI state if the summary endpoint is temporarily unavailable.
    }
  }

  async function ensureSignNowSigningSession(publicId: string) {
    if (signNowEmbedUrl || signNowMode === "placeholder" || reservationSummary?.signingStatus === "COMPLETED") {
      return;
    }

    try {
      setSignNowLoading(true);
      const currentStatus = await requestJson<OpenSignSigningResponse>(`/api/opensign/signing-session-status?reservationPublicId=${encodeURIComponent(publicId)}`);

      if (currentStatus.status === "COMPLETED" || currentStatus.signedDocumentUrl) {
        setSignNowMode(currentStatus.mode);
        setSignNowMessage("The agreement has already been signed.");
        setReservationSummary((current) => ({
          ...current,
          signingStatus: currentStatus.status ?? current?.signingStatus,
          signedDocumentUrl: currentStatus.signedDocumentUrl ?? current?.signedDocumentUrl ?? null,
          status: currentStatus.status === "COMPLETED" ? "CONFIRMED" : current?.status,
        }));
        return;
      }

      if (isSafeEmbeddedSigningUrl(currentStatus.embedUrl)) {
        setSignNowMode(currentStatus.mode);
        setSignNowEmbedUrl(currentStatus.embedUrl ?? "");
        setSignNowMessage(currentStatus.message ?? "Continue with the embedded OpenSign agreement below.");
        return;
      }

      if (currentStatus.embedUrl) {
        setSignNowMode("placeholder");
        setSignNowEmbedUrl("");
        setSignNowMessage("OpenSign returned a non-document URL, so the setup screen was blocked instead of being shown to your customer.");
        return;
      }

      const created = await requestJson<OpenSignSigningResponse>("/api/opensign/create-signing-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationPublicId: publicId }),
      });

      if (isSafeEmbeddedSigningUrl(created.embedUrl)) {
        setSignNowMode(created.mode);
        setSignNowEmbedUrl(created.embedUrl ?? "");
        setSignNowMessage(created.message ?? "");
        return;
      }

      setSignNowMode("placeholder");
      setSignNowEmbedUrl("");
      setSignNowMessage(created.message ?? "OpenSign did not return a signer-specific document URL.");
    } catch (error) {
      setSignNowMessage(error instanceof Error ? error.message : "Could not prepare the OpenSign signing session.");
    } finally {
      setSignNowLoading(false);
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

  function selectFridayOption(option: FridayOption) {
    if (!option.available) {
      return;
    }

    updateField("weekendStartDate", option.weekendStartDate);
    setAvailability(option);
    setAvailabilityMessage(`${option.availableMachineCount} machine(s) are available for this weekend.`);
    setErrorMessage("");
  }

  const selectedFridayAvailability = fridayOptions.find((option) => option.weekendStartDate === draft.weekendStartDate) ?? availability;

  function validateCurrentStep() {
    switch (location.pathname) {
      case "/reserve/package":
        return true;
      case "/reserve/date":
        if (!draft.weekendStartDate) {
          setErrorMessage("Choose one of the available Friday weekends to continue.");
          return false;
        }
        if (!selectedFridayAvailability?.available) {
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
          navigate(`/reserve/sign?reservation=${saved.publicId}`);
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
    setCheckoutClientSecret("");
    setCheckoutPublishableKey("");
    setCheckoutMode("");
    setPaymentStatusMessage("");
    setSignNowMode("");
    setSignNowEmbedUrl("");
    setSignNowMessage("");
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
              <p className="mt-4 text-slate-700">Only Friday start dates can be booked. Unavailable weekends are shown but cannot be selected, and a saved reservation holds inventory for 3 minutes while checkout is completed.</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {fridayOptions.map((option) => {
                  const selected = draft.weekendStartDate === option.weekendStartDate;
                  return (
                    <button
                      key={option.weekendStartDate}
                      type="button"
                      disabled={!option.available}
                      onClick={() => selectFridayOption(option)}
                      className={`rounded-[1.5rem] border px-5 py-5 text-left transition ${
                        selected
                          ? "border-ember bg-ember text-white"
                          : option.available
                            ? "border-slate-200 bg-white hover:border-soil hover:bg-sky"
                            : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      }`}
                    >
                      <p className="font-display text-2xl">{option.label}</p>
                      <p className={`mt-2 text-sm ${selected ? "text-white/85" : option.available ? "text-field" : "text-slate-500"}`}>
                        {option.available ? `${option.availableMachineCount} machine(s) available` : option.reason ?? "Unavailable"}
                      </p>
                      <p className={`mt-2 text-sm ${selected ? "text-white/75" : "text-slate-500"}`}>
                        Weekend ends {formatMondayLabel(option.weekendEndDate)}
                      </p>
                    </button>
                  );
                })}
              </div>
              {fridayOptionsLoading && <p className="mt-4 text-sm text-slate-600">Checking upcoming Fridays...</p>}
              <div className="mt-5 rounded-2xl bg-sky p-4">
                {fridayOptionsLoading ? (
                  <p className="text-sm text-slate-600">Checking availability...</p>
                ) : (
                  <p className={`text-sm font-medium ${selectedFridayAvailability?.available ? "text-field" : "text-soil"}`}>
                    {availabilityMessage || "Choose one of the available Friday weekends to continue."}
                  </p>
                )}
                {selectedFridayAvailability && (
                  <p className="mt-2 text-sm text-slate-600">
                    Weekend: {selectedFridayAvailability.weekendStartDate} to {selectedFridayAvailability.weekendEndDate}
                  </p>
                )}
              </div>
            </div>
          )}

          {location.pathname === "/reserve/delivery" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 3</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Delivery and jobsite details</h2>
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-4 text-sm text-amber-950">
                The excavator is approved only for the jobsite address entered below. Customer transport, relocation to another property, or hauling on your own trailer is prohibited unless Tonka Time Rentals gives prior written approval.
              </p>
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
                <h2 className="mt-2 font-display text-3xl text-soil">Homeowner dig and location-control checklist</h2>
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
              <p className="mt-4 rounded-2xl bg-sky px-4 py-4 text-sm text-slate-700">
                Unauthorized movement, unapproved transport, geofence breach, or tracker tampering are prohibited-use events and may lead to recovery charges, deposit retention, and additional claims under the signed agreement.
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
                  <div className="flex items-center justify-between"><span>Refundable deposit</span><span>{currency(pricing.depositCents)}</span></div>
                  <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-3 font-semibold"><span>Total due today</span><span>{currency(pricing.totalDueCents)}</span></div>
                </div>
                <p className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-sm text-white/80">
                  The {currency(pricing.depositCents)} deposit is refunded after satisfactory machine return.
                </p>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/payment" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 8</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Secure payment</h2>
              <p className="mt-4 text-slate-700">
                Payment is presented only after the checklist and waiver agreement have been signed. Stripe handles the secure payment form here on the page, while Tonka Time keeps the pricing and next steps visible beside it.
              </p>
              <div className="mt-6 grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
                <div className="rounded-[1.5rem] bg-slate-950 p-6 text-white">
                  <p className="text-sm uppercase tracking-[0.2em] text-white/60">Due today</p>
                  <p className="mt-2 text-sm text-white/70">Reservation ID: {reservationIdFromUrl ?? "Missing reservation ID"}</p>
                  <div className="mt-5 grid gap-3 text-sm">
                    <div className="flex items-center justify-between"><span>Weekend rental</span><span>{currency(pricing.rentalSubtotalCents)}</span></div>
                    <div className="flex items-center justify-between"><span>Delivery</span><span>{currency(pricing.deliveryFeeCents)}</span></div>
                    <div className="flex items-center justify-between"><span>Damage waiver</span><span>{currency(pricing.damageWaiverFeeCents)}</span></div>
                    <div className="flex items-center justify-between"><span>Refundable deposit</span><span>{currency(pricing.depositCents)}</span></div>
                    <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-3 text-base font-semibold"><span>Total due today</span><span>{currency(pricing.totalDueCents)}</span></div>
                  </div>
                  <div className="mt-5 rounded-2xl bg-white/5 px-4 py-4 text-sm text-white/80">
                    The {currency(pricing.depositCents)} deposit is refunded upon satisfactory machine return.
                  </div>
                  <div className="mt-4 rounded-2xl bg-white/5 px-4 py-4 text-sm text-white/80">
                    {paymentStatusMessage || (paymentLoading ? "Preparing secure checkout..." : "Stripe will present the available payment methods here once the session is ready.")}
                  </div>
                </div>
                <div className="rounded-[1.5rem] bg-sky p-4">
                  {checkoutMode === "live" && checkoutClientSecret && checkoutPublishableKey ? (
                    <StripeEmbeddedCheckoutCard
                      clientSecret={checkoutClientSecret}
                      publishableKey={checkoutPublishableKey}
                      reservationPublicId={reservationIdFromUrl ?? draft.publicId ?? ""}
                    />
                  ) : checkoutMode === "fake" ? (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <p className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                        Fake Pay Enabled
                      </p>
                      <h3 className="font-display text-2xl text-soil">Fake payment simulation complete</h3>
                      <p className="mt-3 text-slate-700">
                        Because `FAKE_PAY=TRUE` and this reservation used `fakepay@tonkatimerentals.com`, the system simulated a successful paid reservation without contacting Stripe.
                      </p>
                    </div>
                  ) : checkoutMode === "placeholder" ? (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <h3 className="font-display text-2xl text-soil">Stripe placeholder mode</h3>
                      <p className="mt-3 text-slate-700">
                        Stripe publishable or secret keys are still missing, so the page is using the placeholder handoff. Once the live keys are present, this section will render the embedded Stripe payment component automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <p className="text-slate-600">{paymentLoading ? "Preparing secure checkout..." : "Loading Stripe checkout..."}</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {checkoutMode === "fake" && (
                  <button type="button" onClick={() => navigate(`/reserve/confirmation?reservation=${reservationIdFromUrl}`)} className="rounded-full bg-soil px-6 py-3 font-semibold text-white">
                    Continue to confirmation
                  </button>
                )}
                {checkoutMode === "placeholder" && (
                  <button type="button" onClick={() => navigate(`/reserve/confirmation?reservation=${reservationIdFromUrl}`)} className="rounded-full bg-soil px-6 py-3 font-semibold text-white">
                    Continue to confirmation
                  </button>
                )}
                <button type="button" onClick={() => navigate(`/reserve/sign?reservation=${reservationIdFromUrl}`)} className="rounded-full border border-soil px-6 py-3 font-semibold text-soil">
                  Back to signing
                </button>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/sign" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 7</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Agreement signing</h2>
              <p className="mt-4 text-slate-700">
                Review and sign the rental agreement without leaving the reservation flow. The signing step is now aligned to self-hosted OpenSign so the agreement workflow stays on your RackNerd stack.
              </p>
              <div className="mt-6 grid gap-6 xl:grid-cols-[0.38fr_0.62fr]">
                <div className="rounded-2xl bg-field p-5 text-white">
                  <p>Reservation: {reservationSummary?.publicId ?? reservationIdFromUrl ?? "Loading..."}</p>
                  <p className="mt-2">Reservation status: {reservationSummary?.status ?? "Draft / pending payment"}</p>
                  <p className="mt-2">Agreement status: {reservationSummary?.signingStatus ?? "Preparing signature request"}</p>
                  <div className="mt-4 rounded-2xl bg-white/10 px-4 py-4 text-sm text-white/85">
                    {signNowMessage || (signNowLoading ? "Preparing your agreement..." : "Your agreement will appear here once OpenSign is ready.")}
                  </div>
                  {reservationSummary?.signedDocumentUrl && (
                    <a href={reservationSummary.signedDocumentUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full bg-white px-5 py-3 font-semibold text-field">
                      Open signed copy
                    </a>
                  )}
                </div>
                <div className="rounded-[1.5rem] bg-sky p-4">
                  {reservationSummary?.signingStatus === "COMPLETED" || reservationSummary?.signedDocumentUrl ? (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <h3 className="font-display text-2xl text-soil">Agreement completed</h3>
                      <p className="mt-3 text-slate-700">
                        The agreement is already signed. OpenSign should have recorded the completion, and you can also open the saved document from the link here.
                      </p>
                    </div>
                  ) : signNowMode === "live" && signNowEmbedUrl ? (
                    <div className="overflow-hidden rounded-[1.5rem] border border-black/5 bg-white shadow-card">
                      <iframe
                        title="OpenSign agreement signing"
                        src={signNowEmbedUrl}
                        className="min-h-[860px] w-full"
                      />
                    </div>
                  ) : signNowMode === "placeholder" ? (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <h3 className="font-display text-2xl text-soil">Signing session unavailable</h3>
                      <p className="mt-3 text-slate-700">
                        The app could not get a signer-specific agreement URL from OpenSign, so the setup or home screen was blocked instead of being shown to customers. Check the OpenSign API key, template ID, and template signer role.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-[1.5rem] bg-white p-6 shadow-card">
                      <p className="text-slate-600">{signNowLoading ? "Preparing your agreement..." : "Loading the signing experience..."}</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => navigate(`/reserve/payment?reservation=${reservationIdFromUrl}`)}
                  disabled={reservationSummary?.signingStatus !== "COMPLETED"}
                  className="rounded-full bg-soil px-6 py-3 font-semibold text-white disabled:opacity-60"
                >
                  Continue to payment
                </button>
              </div>
            </div>
          )}

          {location.pathname === "/reserve/confirmation" && (
            <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Step 9</p>
              <h2 className="mt-2 font-display text-3xl text-soil">Confirmation summary</h2>
              <p className="mt-4 text-slate-700">
                Your reservation flow is now saved through review and wired into the backend APIs. Payment is embedded, and the signing step is now pointed at OpenSign for the agreement handoff.
              </p>
              <div className="mt-6 rounded-[1.75rem] bg-sky p-6">
                <p className="font-semibold text-slate-700">Reservation ID: {reservationSummary?.publicId ?? reservationIdFromUrl ?? "Pending"}</p>
                {(reservationSummary?.email?.toLowerCase() === "fakepay@tonkatimerentals.com" || checkoutMode === "fake") && (
                  <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                    Fake Pay Reservation
                  </p>
                )}
                <p className="mt-2 text-sm text-slate-600">Weekend: {reservationSummary?.weekendStartDate?.slice(0, 10) ?? draft.weekendStartDate} to {reservationSummary?.weekendEndDate?.slice(0, 10) ?? derivedWeekendEnd}</p>
                <p className="mt-2 text-sm text-slate-600">Delivery zone: {reservationSummary?.deliveryZone ?? draft.deliveryZone ?? "Pending"}</p>
                <p className="mt-4 text-sm text-slate-600">You can create or sign in to an account later with the same email or phone number to see payment status, manage reservations, and cancel an order if needed.</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <NavLink to="/account" className="rounded-full border border-soil px-6 py-3 font-semibold text-soil">
                  Manage this order
                </NavLink>
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
    understandsEquipmentMayBeTracked: "I understand the excavator may contain GPS, geofence, telematics, or anti-theft tracking technology.",
    consentsToLocationMonitoring: "I consent to Tonka Time Rentals monitoring equipment location during the rental period and until the machine is returned or recovered.",
    willUseOnlyAtApprovedJobsite: "I understand the excavator may be used only at the approved jobsite address.",
    willNotMoveWithoutApproval: "I will not move the excavator to another property or jobsite without prior written approval.",
    willNotTransportWithoutApproval: "I will not load, haul, tow, or transport the excavator on my own trailer, truck, rollback, or other vehicle without prior written approval.",
    willNotTamperWithTrackingDevice: "I will not remove, disable, cover, block, or tamper with any GPS, tracker, lock, key, or security device.",
    understandsGeofenceBreachConsequences: "I understand that unauthorized movement, geofence breach, tracker tampering, or unapproved transport may result in rental termination, recovery fees, deposit retention, and additional claims.",
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

function getUpcomingFridays(count: number) {
  const dates: string[] = [];
  const today = new Date();
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  while (cursor.getUTCDay() !== 5) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return dates;
}

function formatFridayLabel(startDate: string) {
  return new Date(`${startDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMondayLabel(endDate: string) {
  return new Date(`${endDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const storedAuth = getStoredAuthSession();
  const headers = new Headers(init?.headers);
  if (storedAuth?.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedAuth.token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });
  const text = await response.text();
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new Error("The server returned an HTML error page. This usually means the reservation tables are missing or the API crashed.");
    }
    throw new Error("The server returned an unexpected response.");
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Request failed.";
    throw new Error(message);
  }

  return data as T;
}

function normalizeReservationSummary<T extends ReservationSummary>(summary: T): T & { signingStatus?: string } {
  return {
    ...summary,
    signingStatus: summary.signingStatus ?? summary.docusealStatus,
  };
}

function isSafeEmbeddedSigningUrl(url: string | null | undefined) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return normalizedPath.length > 0 && normalizedPath !== "/";
  } catch {
    return false;
  }
}

function getStoredAuthSession() {
  const raw = localStorage.getItem(authStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as { token: string; user: AuthUser; expiresAt: string };
  } catch {
    return null;
  }
}

function setStoredAuthSession(session: { token: string; user: AuthUser; expiresAt: string }) {
  localStorage.setItem(authStorageKey, JSON.stringify(session));
}

function clearStoredAuthSession() {
  localStorage.removeItem(authStorageKey);
}

function AccountPage() {
  const [authSession, setAuthSession] = useState<{ token: string; user: AuthUser; expiresAt: string } | null>(() => getStoredAuthSession());
  const [orders, setOrders] = useState<AccountReservation[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [signupForm, setSignupForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [phoneForm, setPhoneForm] = useState({ firstName: "", lastName: "", phone: "", code: "" });
  const [devCode, setDevCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authSession) {
      setOrders([]);
      setNotifications([]);
      return;
    }

    void loadAccountData();
  }, [authSession?.token]);

  async function loadAccountData() {
    try {
      setLoading(true);
      const me = await requestJson<{ user: AuthUser }>("/api/auth/me");
      const [reservationData, notificationData] = await Promise.all([
        requestJson<AccountReservation[]>("/api/account/reservations"),
        requestJson<NotificationItem[]>("/api/account/notifications"),
      ]);
      setAuthSession((current) => current ? { ...current, user: me.user } : current);
      setOrders(reservationData.map(normalizeReservationSummary));
      setNotifications(notificationData);
    } catch (loadError) {
      clearStoredAuthSession();
      setAuthSession(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load your account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    try {
      setLoading(true);
      setError("");
      const response = await requestJson<AuthResponse>("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupForm),
      });
      const session = { token: response.token, user: response.user, expiresAt: response.expiresAt };
      setStoredAuthSession(session);
      setAuthSession(session);
      setMessage("Account created. Matching reservations tied to this email or phone are now available below.");
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Could not create your account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    try {
      setLoading(true);
      setError("");
      const response = await requestJson<AuthResponse>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const session = { token: response.token, user: response.user, expiresAt: response.expiresAt };
      setStoredAuthSession(session);
      setAuthSession(session);
      setMessage("Signed in successfully.");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestPhoneCode() {
    try {
      setLoading(true);
      setError("");
      const response = await requestJson<{ message: string; devCode?: string }>("/api/auth/phone/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: phoneForm.firstName,
          lastName: phoneForm.lastName,
          phone: phoneForm.phone,
        }),
      });
      setDevCode(response.devCode ?? "");
      setMessage(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not send the phone code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyPhoneCode() {
    try {
      setLoading(true);
      setError("");
      const response = await requestJson<AuthResponse>("/api/auth/phone/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneForm.phone,
          code: phoneForm.code,
        }),
      });
      const session = { token: response.token, user: response.user, expiresAt: response.expiresAt };
      setStoredAuthSession(session);
      setAuthSession(session);
      setMessage("Phone authentication complete.");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify the phone code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local session either way.
    }
    clearStoredAuthSession();
    setAuthSession(null);
    setMessage("Signed out.");
  }

  async function handleCancelReservation(publicId: string) {
    const confirmed = window.confirm(`Cancel reservation ${publicId}? Paid reservations will be refunded.`);
    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      const result = await requestJson<{ refundIssued: boolean; refundAmountCents: number; reservation: AccountReservation }>(`/api/account/reservations/${publicId}/cancel`, {
        method: "POST",
      });
      setOrders((current) => current.map((order) => (order.publicId === publicId ? normalizeReservationSummary(result.reservation) : order)));
      setMessage(result.refundIssued ? `Reservation ${publicId} cancelled and refund initiated.` : `Reservation ${publicId} cancelled.`);
      await loadAccountData();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel this reservation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SimplePage title="Your Account" intro="Account access is optional. Use the same email or phone number from your reservation to claim orders, review payment status, and cancel an active booking.">
      {error && <p className="mb-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {message && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

      {!authSession ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Email account</p>
            <h2 className="mt-2 font-display text-3xl text-soil">Sign up with email and password</h2>
            <div className="mt-6 grid gap-3">
              <input value={signupForm.firstName} onChange={(event) => setSignupForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="First name" className="rounded-2xl border border-black/10 px-4 py-3" />
              <input value={signupForm.lastName} onChange={(event) => setSignupForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Last name" className="rounded-2xl border border-black/10 px-4 py-3" />
              <input value={signupForm.email} onChange={(event) => setSignupForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="rounded-2xl border border-black/10 px-4 py-3" />
              <input value={signupForm.phone} onChange={(event) => setSignupForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone (optional)" className="rounded-2xl border border-black/10 px-4 py-3" />
              <input type="password" value={signupForm.password} onChange={(event) => setSignupForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" className="rounded-2xl border border-black/10 px-4 py-3" />
            </div>
            <button type="button" onClick={() => void handleSignup()} disabled={loading} className="mt-6 rounded-full bg-soil px-6 py-3 font-semibold text-white disabled:opacity-60">
              {loading ? "Working..." : "Create account"}
            </button>
            <div className="mt-8 border-t border-black/5 pt-6">
              <h3 className="font-display text-2xl text-soil">Already have an account?</h3>
              <div className="mt-4 grid gap-3">
                <input value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="rounded-2xl border border-black/10 px-4 py-3" />
                <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" className="rounded-2xl border border-black/10 px-4 py-3" />
              </div>
              <button type="button" onClick={() => void handleLogin()} disabled={loading} className="mt-4 rounded-full border border-soil px-6 py-3 font-semibold text-soil disabled:opacity-60">
                Sign in
              </button>
            </div>
          </section>

          <section className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-card">
            <p className="text-sm uppercase tracking-[0.2em] text-white/60">Phone access</p>
            <h2 className="mt-2 font-display text-3xl">Sign in by text message</h2>
            <p className="mt-3 text-white/75">Use the phone number from your reservation and we’ll attach matching orders to your account after verification.</p>
            <div className="mt-6 grid gap-3">
              <input value={phoneForm.firstName} onChange={(event) => setPhoneForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="First name (optional)" className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/45" />
              <input value={phoneForm.lastName} onChange={(event) => setPhoneForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Last name (optional)" className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/45" />
              <input value={phoneForm.phone} onChange={(event) => setPhoneForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Mobile phone" className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/45" />
            </div>
            <button type="button" onClick={() => void handleRequestPhoneCode()} disabled={loading} className="mt-6 rounded-full bg-ember px-6 py-3 font-semibold text-white disabled:opacity-60">
              Send text code
            </button>
            <div className="mt-8 border-t border-white/10 pt-6">
              <input value={phoneForm.code} onChange={(event) => setPhoneForm((current) => ({ ...current, code: event.target.value }))} placeholder="6-digit code" className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/45" />
              <button type="button" onClick={() => void handleVerifyPhoneCode()} disabled={loading} className="mt-4 rounded-full border border-white/20 px-6 py-3 font-semibold text-white disabled:opacity-60">
                Verify code
              </button>
              {devCode && <p className="mt-4 text-sm text-amber-300">Dev code: {devCode}</p>}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Signed in</p>
                <h2 className="mt-2 font-display text-3xl text-soil">{authSession.user.firstName || authSession.user.email || authSession.user.phone || "Tonka customer"}</h2>
                <p className="mt-2 text-slate-600">Orders linked to {authSession.user.email ?? authSession.user.phone ?? "your account"} appear below.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {authSession.user.role === "ADMIN" && (
                  <NavLink to="/admin" className="rounded-full border border-soil px-5 py-3 font-semibold text-soil">
                    Open admin
                  </NavLink>
                )}
                <button type="button" onClick={() => void handleLogout()} className="rounded-full bg-soil px-5 py-3 font-semibold text-white">
                  Sign out
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <h2 className="font-display text-3xl text-soil">Reservations and payment status</h2>
            <div className="mt-6 grid gap-4">
              {orders.length === 0 ? (
                <p className="text-slate-600">{loading ? "Loading reservations..." : "No reservations are linked to this account yet."}</p>
              ) : (
                orders.map((order) => (
                  <article key={order.id} className="rounded-[1.5rem] border border-black/5 bg-sky p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-2xl text-soil">{order.publicId}</h3>
                        {(order.email?.toLowerCase() === "fakepay@tonkatimerentals.com" || Boolean(order.internalFlags && typeof order.internalFlags === "object" && (order.internalFlags as Record<string, unknown>).fakePay)) && (
                          <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                            Fake Pay Reservation
                          </p>
                        )}
                        <p className="mt-2 text-sm text-slate-700">Weekend: {order.weekendStartDate?.slice(0, 10)} to {order.weekendEndDate?.slice(0, 10)}</p>
                        <p className="mt-2 text-sm text-slate-700">Reservation status: {order.status ?? "Pending"}</p>
                        <p className="mt-2 text-sm text-slate-700">Payment status: {order.paymentStatus ?? "Not started"}</p>
                        <p className="mt-2 text-sm text-slate-700">Total due: {currency(order.totalDueCents ?? 0)}</p>
                      </div>
                      {order.status !== "CANCELLED" && ["DRAFT", "PENDING_PAYMENT", "PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "CONFIRMED"].includes(order.status ?? "") && (
                        <button type="button" onClick={() => void handleCancelReservation(order.publicId ?? "")} className="rounded-full border border-rose-300 px-5 py-3 font-semibold text-rose-700">
                          Cancel and refund
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <h2 className="font-display text-3xl text-soil">Notifications</h2>
            <div className="mt-6 grid gap-3">
              {notifications.length === 0 ? (
                <p className="text-slate-600">No account notifications yet.</p>
              ) : (
                notifications.map((item) => (
                  <article key={item.id} className="rounded-[1.25rem] border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{item.channel} · {item.status}</p>
                    <p className="mt-2 font-semibold text-soil">{item.subject ?? item.destination}</p>
                    <p className="mt-2 text-sm text-slate-700">{item.message}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </SimplePage>
  );
}

function AdminPage() {
  const [authSession, setAuthSession] = useState<{ token: string; user: AuthUser; expiresAt: string } | null>(() => getStoredAuthSession());
  const [reservations, setReservations] = useState<Array<AccountReservation & { user?: AuthUser; notifications?: NotificationItem[] }>>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function loadAdminData() {
    try {
      setLoading(true);
      const me = await requestJson<{ user: AuthUser }>("/api/auth/me");
      if (me.user.role !== "ADMIN") {
        setAuthSession(null);
        setError("Admin access is only available to authenticated admin users.");
        return;
      }

      setAuthSession((current) => current ? { ...current, user: me.user } : current);
      const [reservationData, notificationData] = await Promise.all([
        requestJson<Array<AccountReservation & { user?: AuthUser; notifications?: NotificationItem[] }>>("/api/admin/reservations"),
        requestJson<NotificationItem[]>("/api/admin/notifications"),
      ]);
      setReservations(reservationData.map((item) => ({ ...normalizeReservationSummary(item), user: item.user, notifications: item.notifications })));
      setNotifications(notificationData);
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : "Could not load the admin dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminCancel(publicId: string) {
    const confirmed = window.confirm(`Cancel reservation ${publicId} from the admin dashboard?`);
    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      const result = await requestJson<{ refundIssued: boolean }>(`/api/admin/reservations/${publicId}/cancel`, { method: "POST" });
      setMessage(result.refundIssued ? `Reservation ${publicId} cancelled and refund initiated.` : `Reservation ${publicId} cancelled.`);
      await loadAdminData();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel this reservation.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminDelete(publicId: string) {
    const confirmed = window.confirm(`Delete fake reservation ${publicId}? This permanently removes the reservation record.`);
    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      await requestJson(`/api/admin/reservations/${publicId}`, { method: "DELETE" });
      setMessage(`Fake reservation ${publicId} deleted.`);
      await loadAdminData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this fake reservation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SimplePage title="Admin Portal" intro="This dashboard now uses authenticated admin access so orders, payment state, and cancellation/refund actions live behind the seeded Tonka admin account.">
      {error && <p className="mb-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {message && <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

      {!authSession || authSession.user.role !== "ADMIN" ? (
        <div className="rounded-[1.75rem] bg-white p-6 shadow-card">
          <h2 className="font-display text-3xl text-soil">Admin sign-in required</h2>
          <p className="mt-3 text-slate-700">Sign in through the account page with `admin@tonkatimerentals.com` to manage reservations and refunds here.</p>
          <NavLink to="/account" className="mt-6 inline-flex rounded-full bg-soil px-6 py-3 font-semibold text-white">
            Open account login
          </NavLink>
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-[1.5rem] bg-sky p-5">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Reservations</p>
                <p className="mt-3 font-display text-4xl text-soil">{reservations.length}</p>
              </article>
              <article className="rounded-[1.5rem] bg-sky p-5">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Active orders</p>
                <p className="mt-3 font-display text-4xl text-soil">{reservations.filter((item) => item.status !== "CANCELLED").length}</p>
              </article>
              <article className="rounded-[1.5rem] bg-sky p-5">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Notifications</p>
                <p className="mt-3 font-display text-4xl text-soil">{notifications.length}</p>
              </article>
            </div>
          </section>

          <section className="rounded-[1.75rem] bg-white p-6 shadow-card">
            <h2 className="font-display text-3xl text-soil">Order management</h2>
            <div className="mt-6 grid gap-4">
              {reservations.length === 0 ? (
                <p className="text-slate-600">{loading ? "Loading orders..." : "No reservations found."}</p>
              ) : (
                reservations.map((order) => (
                  (() => {
                    const fakePayFlags = order.internalFlags && typeof order.internalFlags === "object" ? (order.internalFlags as Record<string, unknown>).fakePay : null;
                    const isFakeReservation = order.email?.toLowerCase() === "fakepay@tonkatimerentals.com" || Boolean(fakePayFlags);
                    return (
                  <article key={order.id} className="rounded-[1.5rem] border border-black/5 bg-sky p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-2xl text-soil">{order.publicId}</h3>
                        {isFakeReservation && (
                          <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                            Fake Pay Reservation
                          </p>
                        )}
                        <p className="mt-2 text-sm text-slate-700">Customer: {order.user?.email ?? order.email ?? "No email"} / {order.user?.phone ?? order.phone ?? "No phone"}</p>
                        <p className="mt-2 text-sm text-slate-700">Weekend: {order.weekendStartDate?.slice(0, 10)} to {order.weekendEndDate?.slice(0, 10)}</p>
                        <p className="mt-2 text-sm text-slate-700">Reservation status: {order.status}</p>
                        <p className="mt-2 text-sm text-slate-700">Payment status: {order.paymentStatus ?? "Not started"}</p>
                        <p className="mt-2 text-sm text-slate-700">Agreement status: {order.signingStatus ?? "Not started"}</p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {order.status !== "CANCELLED" && (
                          <button type="button" onClick={() => void handleAdminCancel(order.publicId ?? "")} className="rounded-full border border-rose-300 px-5 py-3 font-semibold text-rose-700">
                            Cancel and refund
                          </button>
                        )}
                        {isFakeReservation && (
                          <button type="button" onClick={() => void handleAdminDelete(order.publicId ?? "")} className="rounded-full border border-slate-400 px-5 py-3 font-semibold text-slate-700">
                            Delete fake reservation
                          </button>
                        )}
                      </div>
                    </div>
                    {order.notifications && order.notifications.length > 0 && (
                      <div className="mt-4 rounded-[1.25rem] bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Recent notifications</p>
                        <div className="mt-3 grid gap-2">
                          {order.notifications.map((note) => (
                            <p key={note.id} className="text-sm text-slate-700">{note.channel} · {note.status} · {note.message}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                    );
                  })()
                ))
              )}
            </div>
          </section>
        </div>
      )}
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
      <Route path="/account" element={<AccountPage />} />
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
