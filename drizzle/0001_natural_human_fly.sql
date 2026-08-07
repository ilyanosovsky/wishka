CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_kind_check";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_state_check";--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_kind_check" CHECK ("ai_usage"."kind" in ('image', 'text', 'upload'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_state_check" CHECK ("reservations"."state" in ('active', 'cancelled', 'fulfilled'));