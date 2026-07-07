import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.rentalPackage.upsert({
    where: { slug: "weekend-mini-excavator-rental" },
    update: {},
    create: {
      name: "Weekend Mini Excavator Rental",
      slug: "weekend-mini-excavator-rental",
      description: "Friday delivery, Monday pickup, hydraulic thumb, homeowner-focused support.",
      weekendPriceCents: 59500,
      defaultDepositCents: 50000,
      damageWaiverCents: 7500,
      baseDeliveryCents: 10000,
    },
  });

  await prisma.machine.upsert({
    where: { unitNumber: "TTR-01" },
    update: {},
    create: {
      name: "Kubota KX018-4",
      unitNumber: "TTR-01",
      description: "Primary homeowner rental machine.",
    },
  });

  await prisma.machine.upsert({
    where: { unitNumber: "TTR-02" },
    update: {},
    create: {
      name: "Kubota KX018-4 Backup",
      unitNumber: "TTR-02",
      description: "Overflow and maintenance-rotation machine.",
    },
  });

  const areas = [
    "Colorado Springs",
    "Fountain",
    "Security-Widefield",
    "Falcon",
    "Peyton",
    "Monument",
    "Black Forest",
    "Manitou Springs",
  ];

  for (const city of areas) {
    await prisma.serviceArea.upsert({
      where: { id: `seed-${city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` },
      update: {
        label: city,
        city,
        zone: "CORE",
        baseFeeCents: 10000,
      },
      create: {
        id: `seed-${city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: city,
        city,
        zone: "CORE",
        baseFeeCents: 10000,
      },
    });
  }

  for (const faq of [
    {
      category: "Reservation and scheduling",
      question: "How does the weekend rental work?",
      answer: "We deliver Friday, provide a quick walkthrough, and pick up Monday.",
    },
    {
      category: "Safety and 811",
      question: "Do I need to contact Colorado 811?",
      answer: "Yes. You must submit an 811 request and verify private utilities before digging.",
    },
  ]) {
    const existing = await prisma.faqItem.findFirst({ where: { question: faq.question } });
    if (!existing) {
      await prisma.faqItem.create({ data: faq });
    }
  }

  await prisma.tutorialVideo.createMany({
    data: [
      {
        title: "How to start and shut down the mini excavator",
        slug: "start-and-shutdown",
        category: "Quick Start",
        description: "Placeholder record for startup tutorial content.",
        videoUrl: "https://example.com/videos/start-and-shutdown",
      },
      {
        title: "Using the hydraulic thumb",
        slug: "using-the-hydraulic-thumb",
        category: "Operation",
        description: "Placeholder record for thumb operation tutorial.",
        videoUrl: "https://example.com/videos/hydraulic-thumb",
      },
    ],
    skipDuplicates: true,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
