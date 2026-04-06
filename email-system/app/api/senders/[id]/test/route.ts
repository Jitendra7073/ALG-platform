/**
 * POST /api/senders/[id]/test
 * Test email sender connection
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
} from '../../../../db';
import {
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
  errorResponse,
} from '../../../../validation';
import nodemailer from 'nodemailer';

// ============================================================================
// POST /api/senders/[id]/test - Test sender connection
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Get sender with password
  const sender = await dbGet<{
    email: string;
    password: string;
    service: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
  }>(
    'SELECT email, password, service, smtp_host, smtp_port, smtp_user FROM email_senders WHERE id = $1',
    [id],
  );

  if (!sender) {
    return notFound('Sender not found');
  }

  try {
    let transporterConfig;

    if (sender.service === 'custom' || sender.service === 'smtp') {
      if (!sender.smtp_host || !sender.smtp_port) {
        return errorResponse(400, 'SMTP configuration incomplete');
      }

      transporterConfig = {
        host: sender.smtp_host,
        port: sender.smtp_port,
        secure: sender.smtp_port === 465,
        auth: {
          user: sender.smtp_user || sender.email,
          pass: sender.password,
        },
      };
    } else {
      transporterConfig = {
        service: sender.service,
        auth: {
          user: sender.smtp_user || sender.email,
          pass: sender.password,
        },
      };
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    // Test the connection
    await new Promise<void>((resolve, reject) => {
      transporter.verify((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    return successResponse(
      {
        sender_id: id,
        email: sender.email,
        service: sender.service,
      },
      'Connection test successful',
    );
  } catch (err: unknown) {
    const error = err as { message?: string };
    return errorResponse(500, `Connection test failed: ${error.message || 'Unknown error'}`);
  }
});
