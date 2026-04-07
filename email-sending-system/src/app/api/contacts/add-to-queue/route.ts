import { NextResponse } from 'next/server';
import { executeQuery, dbPool } from '@/lib/db/postgres';
import { detectTimezone } from '@/lib/schedule/timezone-detector';

export async function POST(request: Request) {
  const client = await dbPool.connect();

  try {
    const body = await request.json();
    const { contact_ids, template_id } = body;

    if (!contact_ids || !Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'contact_ids array is required'
      }, { status: 400 });
    }

    await client.query('BEGIN');

    // Get or create a default template if none provided
    let templateId = template_id;

    if (!templateId) {
      // Check if there's a default template
      const defaultTemplateResult = await client.query(
        'SELECT id FROM email_templates WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
      );

      if (defaultTemplateResult.rows.length === 0) {
        // Create a simple default template
        const templateResult = await client.query(
          `INSERT INTO email_templates (name, subject, html_content, is_active, category)
           VALUES ($1, $2, $3, true, $4)
           RETURNING id`,
          [
            'Default Template',
            'Hello from our team',
            '<html><body><h1>Hello!</h1><p>This is a test email from our system.</p></body></html>',
            'general'
          ]
        );
        templateId = templateResult.rows[0].id;
      } else {
        templateId = defaultTemplateResult.rows[0].id;
      }
    }

    // Get template details
    const templateResult = await client.query(
      'SELECT * FROM email_templates WHERE id = $1',
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        success: false,
        error: 'Template not found'
      }, { status: 404 });
    }

    const template = templateResult.rows[0];

    // Get contact details and enrich with timezone
    const contactsResult = await client.query(
      `SELECT c.*, s.country, s.url as site_url
       FROM contacts c
       LEFT JOIN sites s ON c.site_id = s.id
       WHERE c.id = ANY($1) AND c.type = 'email'`,
      [contact_ids]
    );

    if (contactsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        success: false,
        error: 'No valid email contacts found'
      }, { status: 404 });
    }

    // Create a simple campaign for tracking
    const campaignResult = await client.query(
      `INSERT INTO email_campaigns (name, status, total_recipients)
       VALUES ($1, 'running', $2)
       RETURNING id`,
      [`Quick Send - ${new Date().toLocaleDateString()}`, contactsResult.rows.length]
    );

    const campaignId = campaignResult.rows[0].id;

    // Add contacts to queue
    const queuedEmails = [];
    const now = new Date();

    for (const contact of contactsResult.rows) {
      // Detect timezone if not present
      if (!contact.timezone || !contact.country_code) {
        const detection = await detectTimezone(contact.value);
        if (detection) {
          await client.query(
            `UPDATE contacts SET timezone = $1, country_code = $2, updated_at = NOW() WHERE id = $3`,
            [detection.timezone, detection.country_code, contact.id]
          );
          contact.timezone = detection.timezone;
          contact.country_code = detection.country_code;
        }
      }

      // Insert into email queue with status 'ready_to_send'
      const queueResult = await client.query(
        `INSERT INTO email_queue
         (campaign_id, contact_id, recipient_email, recipient_name, subject, html_content,
          template_id, scheduled_at, adjusted_scheduled_at, status, sequence_position,
          recipient_timezone, country_code, dependency_satisfied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), 'ready_to_send', 1, $8, $9, true)
         RETURNING id`,
        [
          campaignId,
          contact.id,
          contact.value,
          contact.value.split('@')[0], // Use part before @ as name
          template.subject,
          template.html_content,
          templateId,
          contact.timezone || 'UTC',
          contact.country_code || 'US'
        ]
      );

      queuedEmails.push({
        queue_id: queueResult.rows[0].id,
        contact_id: contact.id,
        email: contact.value
      });
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: `Successfully added ${queuedEmails.length} contacts to email queue`,
      data: {
        campaign_id: campaignId,
        queued_emails: queuedEmails,
        total_queued: queuedEmails.length
      }
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    client.release();
  }
}