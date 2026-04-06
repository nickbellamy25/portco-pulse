ALTER TABLE `email_settings` ADD `submission_reminder_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `monthly_digest_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `threshold_alert_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `submission_notification_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `monthly_digest_recipients` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `monthly_digest_subject` text DEFAULT 'PortCo Pulse - Monthly Portfolio Digest for {{month_year}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `monthly_digest_body` text DEFAULT 'Portfolio Submission Summary - {{month_year}}

Here''s your monthly summary of portfolio company performance:

Portfolio Overview:
• Total Companies: {{total_companies}}
• Companies Submitted This Period: {{submitted_count}}
• Active Alerts: {{active_alerts}}

View full dashboard: {{dashboard_link}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `threshold_alert_recipients` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `threshold_alert_subject` text DEFAULT '⚠️ Threshold Breach Alert - {{company_name}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `threshold_alert_body` text DEFAULT '⚠️ THRESHOLD BREACH ALERT

A threshold breach has been detected for {{company_name}}:

Breach Details:
• Metric: {{metric_name}}
• Value: {{value}}
• Period: {{period}}
• Submission: {{submission_date}}
• Threshold: {{threshold_value}}
• Severity: {{severity}}
• Partner: {{partner_email}}

View full details: {{dashboard_link}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `submission_notification_recipients` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `submission_notification_subject` text DEFAULT 'New Submission Received - {{company_name}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `submission_notification_body` text DEFAULT 'A new submission has been received from {{company_name}}.

Submission Details:
• Period: {{period}}
• Submitted by: {{submitted_by}}
• Submission time: {{submission_time}}

Key Metrics:
• Revenue: {{revenue}}
• EBITDA: {{ebitda}}
• Operating Cash Flow: {{ocf}}
• Gross Margin: {{gross_margin}}
• Cash: {{cash}}

View full details: {{dashboard_link}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `invitation_subject` text DEFAULT 'You''ve been invited to PortCo Pulse' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `invitation_body` text DEFAULT 'Hello,

You have been invited to join PortCo Pulse, a portfolio monitoring platform.

Click the link below to set up your account:
{{invitation_link}}

This link expires in 48 hours.

Thank you.' NOT NULL;