DROP INDEX "pos_orders_client_uq";--> statement-breakpoint
ALTER TABLE "pos_orders" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "pos_orders" DROP COLUMN "offline_at";