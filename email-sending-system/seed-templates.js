/**
 * Template seeding script for Supabase database
 * Run this with: node seed-templates.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in .env file');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const templates = [
  {
    name: 'Welcome Email',
    subject: 'Welcome to Our Network! {{first_name}}',
    category: 'welcome',
    description: 'Initial welcome email for new contacts',
    html_content: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome Email</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Our Network!</h1>
        </div>
        <div class="content">
            <p>Hi {{first_name}},</p>
            <p>We're thrilled to have you join our community! Your interest in {{company_name}} means a lot to us.</p>
            <p>Here's what you can expect from us:</p>
            <ul>
                <li>✓ Valuable industry insights and tips</li>
                <li>✓ Exclusive offers and early access to new features</li>
                <li>✓ Personalized support to help you achieve your goals</li>
            </ul>
            <p>We're committed to helping you succeed and look forward to building a lasting relationship.</p>
            <a href="{{website_url}}" class="button">Explore Our Services</a>
            <p>If you have any questions, feel free to reach out. We're here to help!</p>
            <p>Best regards,<br>{{sender_name}}</p>
        </div>
        <div class="footer">
            <p>You received this email because you subscribed to our network. To unsubscribe, <a href="{{unsubscribe_url}}">click here</a>.</p>
        </div>
    </div>
</body>
</html>`,
    is_active: true
  },
  {
    name: 'Follow Up 1',
    subject: 'Following Up: {{previous_subject}}',
    category: 'follow_up',
    description: 'First follow-up email after initial contact',
    html_content: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Follow Up 1</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 30px; background: #f5576c; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Just Following Up!</h1>
        </div>
        <div class="content">
            <p>Hi {{first_name}},</p>
            <p>I wanted to follow up on my previous email regarding {{company_name}}.</p>
            <p>I understand you're busy, but I wanted to make sure you received my message and see if you had a chance to consider our proposal.</p>
            <p><strong>Quick reminder of what we discussed:</strong></p>
            <ul>
                <li>📌 How our solutions can help streamline your operations</li>
                <li>📌 The potential cost savings we can offer</li>
                <li>📌 Success stories from similar businesses in your industry</li>
            </ul>
            <p>Would you be available for a quick 15-minute call this week to discuss this further?</p>
            <a href="{{calendar_url}}" class="button">Schedule a Call</a>
            <p>I'm flexible with timing and can work around your schedule. Let me know what works best for you!</p>
            <p>Looking forward to hearing from you.<br>{{sender_name}}</p>
        </div>
        <div class="footer">
            <p>To opt out of future communications, <a href="{{unsubscribe_url}}">click here</a>.</p>
        </div>
    </div>
</body>
</html>`,
    is_active: true
  },
  {
    name: 'Follow Up 2',
    subject: 'Quick Question About {{previous_topic}}',
    category: 'follow_up',
    description: 'Second follow-up email with added value proposition',
    html_content: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Follow Up 2</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 30px; background: #00f2fe; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Quick Question</h1>
        </div>
        <div class="content">
            <p>Hi {{first_name}},</p>
            <p>I hope you're having a great week!</p>
            <p>I wanted to reach out one more time with a quick question: <strong>Is improving your {{business_area}} a priority for you this quarter?</strong></p>
            <p>I've been thinking about your situation and wanted to share a few insights:</p>
            <div style="background: white; padding: 15px; border-left: 4px solid #00f2fe; margin: 20px 0;">
                <p><strong>💡 Industry Insight:</strong> Companies that implement solutions like ours see an average of 40% improvement in efficiency within the first 3 months.</p>
            </div>
            <p><strong>What's changed since we last spoke:</strong></p>
            <ul>
                <li>✨ We've just launched new features that directly address common pain points</li>
                <li>✨ Limited-time offer: 20% off for new customers who sign up this month</li>
                <li>✨ Free consultation and personalized implementation plan</li>
            </ul>
            <p>Would you be open to a brief discussion to see if we're the right fit for your needs?</p>
            <a href="{{calendar_url}}" class="button">Let's Talk</a>
            <p>No pressure at all - just want to make sure you have all the information you need to make the best decision for your business.</p>
            <p>Best,<br>{{sender_name}}</p>
        </div>
        <div class="footer">
            <p>To unsubscribe from these emails, <a href="{{unsubscribe_url}}">click here</a>.</p>
        </div>
    </div>
</body>
</html>`,
    is_active: true
  },
  {
    name: 'Promotional Offer',
    subject: '🎉 Exclusive Offer: {{offer_title}} - Limited Time!',
    category: 'promotion',
    description: 'Promotional email with special offers and discounts',
    html_content: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Promotional Offer</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 30px; background: #fa709a; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .promo-box { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Exclusive Limited-Time Offer!</h1>
        </div>
        <div class="content">
            <p>Hi {{first_name}},</p>
            <p>We have some exciting news for you!</p>

            <div class="promo-box">
                <h2>🔥 SPECIAL OFFER: {{discount_percentage}}% OFF!</h2>
                <p>Valid until: {{expiry_date}}</p>
                <p style="font-size: 24px; font-weight: bold;">Use Code: {{promo_code}}</p>
            </div>

            <p>For a limited time, you can get <strong>{{offer_title}}</strong> at an unbeatable price!</p>

            <h3>What You'll Get:</h3>
            <ul>
                <li>✅ Full access to all premium features</li>
                <li>✅ Priority customer support</li>
                <li>✅ Free setup and onboarding</li>
                <li>✅ 30-day money-back guarantee</li>
            </ul>

            <h3>Why Act Now?</h3>
            <ul>
                <li>⏰ This offer expires on {{expiry_date}}</li>
                <li>🎁 Limited spots available at this price</li>
                <li>📈 Join hundreds of satisfied customers</li>
            </ul>

            <a href="{{offer_url}}" class="button">Claim Your {{discount_percentage}}% Discount Now</a>

            <p><strong>Don't miss out!</strong> This is our best offer of the year, and it's only available for a short time.</p>

            <p>Questions? Reply to this email or call us at {{phone_number}}. We're here to help!</p>

            <p>We hope to welcome you aboard soon!<br>Best regards,<br>{{sender_name}}</p>
        </div>
        <div class="footer">
            <p>Offer terms and conditions apply. <a href="{{unsubscribe_url}}">Unsubscribe</a> from future promotional emails.</p>
        </div>
    </div>
</body>
</html>`,
    is_active: true
  }
];

async function seedTemplates() {
  const client = await pool.connect();

  try {
    console.log('🌱 Starting template seeding...\n');

    // Check if email_templates table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'email_templates'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('➕ Creating email_templates table...');
      await client.query(`
        CREATE TABLE email_templates (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          subject TEXT NOT NULL,
          html_content TEXT NOT NULL,
          category VARCHAR(100),
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Created email_templates table\n');
    } else {
      console.log('✓ email_templates table already exists\n');
    }

    // Clear existing templates (optional - comment out if you want to keep existing templates)
    console.log('🗑️  Clearing existing templates...');
    await client.query('DELETE FROM email_templates');
    console.log('✅ Cleared existing templates\n');

    // Insert new templates
    console.log('📝 Inserting templates...\n');

    for (const template of templates) {
      const result = await client.query(
        `INSERT INTO email_templates (name, subject, html_content, category, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name`,
        [template.name, template.subject, template.html_content, template.category, template.description, template.is_active]
      );

      console.log(`✅ Inserted: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
    }

    console.log('\n📊 Seeding Summary:');
    console.log(`   Total templates inserted: ${templates.length}`);

    // Display all templates
    console.log('\n📋 All Templates in Database:');
    const allTemplates = await client.query('SELECT id, name, category, is_active FROM email_templates ORDER BY id');

    allTemplates.rows.forEach((template, index) => {
      console.log(`   ${index + 1}. ${template.name} (${template.category}) - ${template.is_active ? 'Active' : 'Inactive'}`);
    });

    console.log('\n✅ Template seeding completed successfully!');

  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedTemplates().catch(console.error);
