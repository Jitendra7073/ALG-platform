import nodemailer from 'nodemailer';
import { supabaseAdmin } from '../supabase/client';

export async function sendEmailWithNodemailer(senderId: string, recipient: string, subject: string, htmlContent: string) {
  // 1. Fetch sender credentials from Supabase
  // Use .limit(1) instead of .single() to handle potential duplicates gracefully
  const { data: senders, error } = await supabaseAdmin
    .from('email_senders')
    .select('*')
    .eq('id', senderId)
    .limit(1);

  const sender = senders && senders.length > 0 ? senders[0] : null;

  if (error || !sender) {
    throw new Error(`Sender not found or error fetching credentials: ${error?.message || 'Sender ID not found'}`);
  }

  // Warn if duplicates exist (should be investigated)
  if (senders && senders.length > 1) {
    console.warn(`⚠️ Multiple sender records found for ID ${senderId}. Using the first one.`);
  }

  // 2. Configure Nodemailer transport
  const transporter = nodemailer.createTransport({
    host: sender.smtp_host || 'smtp.gmail.com',
    port: sender.smtp_port || 587,
    secure: sender.smtp_port === 465, // true for 465, false for other ports
    auth: {
      user: sender.smtp_user || sender.email,
      pass: sender.app_password || sender.password, // Use app_password for Gmail
    },
  });

  // 3. Send email
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: recipient,
    subject: subject,
    html: htmlContent,
  });

  return info;
}
