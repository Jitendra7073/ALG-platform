import nodemailer from 'nodemailer';
import { supabaseAdmin } from '../supabase/client';

export async function sendEmailWithNodemailer(senderId: string, recipient: string, subject: string, htmlContent: string) {
  // 1. Fetch sender credentials from Supabase
  const { data: sender, error } = await supabaseAdmin
    .from('email_senders')
    .select('*')
    .eq('id', senderId)
    .single();

  if (error || !sender) {
    throw new Error(`Sender not found or error fetching credentials: ${error?.message}`);
  }

  // 2. Configure Nodemailer transport
  const transporter = nodemailer.createTransport({
    host: sender.smtp_host || '',
    port: sender.smtp_port || 587,
    secure: sender.smtp_port === 465, // true for 465, false for other ports
    auth: {
      user: sender.smtp_user || sender.email,
      pass: sender.password, // Plain text password fetched securely via service role
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
