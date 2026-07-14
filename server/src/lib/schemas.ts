import { z } from "zod";

export const reservationCreateSchema = z.object({
  packageSlug: z.string().default("weekend-mini-excavator-rental"),
  weekendStartDate: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  jobsiteStreet: z.string().min(1),
  jobsiteCity: z.string().min(1),
  jobsiteState: z.string().min(2).default("CO"),
  jobsiteZip: z.string().min(5),
  gateAccessNotes: z.string().optional().default(""),
  surfaceAccessNotes: z.string().optional().default(""),
  workDescription: z.string().optional().default(""),
  isPropertyOwner: z.boolean().default(true),
  ownerPermission: z.boolean().default(true),
  damageWaiverChoice: z.enum(["ACCEPTED", "DECLINED"]).default("ACCEPTED"),
  colorado811Ticket: z.string().optional(),
  checklist: z.record(z.boolean()).optional(),
  tutorialAcknowledgement: z.record(z.boolean()).optional(),
  waiverAcknowledged: z.boolean().optional(),
});

export const reservationUpdateSchema = reservationCreateSchema.partial().extend({
  checklistCompleted: z.boolean().optional(),
});

export const availabilityQuerySchema = z.object({
  startDate: z.string(),
});
