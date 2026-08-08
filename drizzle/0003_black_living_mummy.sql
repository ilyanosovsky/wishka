ALTER TABLE "reservations" DROP CONSTRAINT "reservations_state_check";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_wish_id_wishes_id_fk";--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "wish_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "list_owner_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_title" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_url" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_price_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_price_min" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_price_max" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "wish_currency" char(3);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "locale" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
-- Backfill before SET NOT NULL. Until now "wish_id" was NOT NULL with ON DELETE cascade,
-- so every existing reservation still has its wish row and this UPDATE reaches all of them.
UPDATE "reservations" r SET "list_owner_id" = w."owner_id", "wish_title" = w."title", "wish_url" = w."url", "wish_price_type" = w."price_type", "wish_price_min" = w."price_min", "wish_price_max" = w."price_max", "wish_currency" = w."currency" FROM "wishes" w WHERE r."wish_id" = w."id";--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "list_owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "wish_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_list_owner_id_user_id_fk" FOREIGN KEY ("list_owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_reserver_user_id_idx" ON "reservations" USING btree ("reserver_user_id");--> statement-breakpoint
CREATE INDEX "reservations_guest_id_idx" ON "reservations" USING btree ("guest_id");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_locale_check" CHECK ("reservations"."locale" in ('ru', 'en'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_state_check" CHECK ("reservations"."state" in ('active', 'cancelled', 'fulfilled', 'orphaned'));
