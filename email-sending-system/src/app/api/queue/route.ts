import { NextResponse } from 'next/server';
import { executeQuery } from '@/lib/db/postgres';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const campaign_id = searchParams.get('campaign_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = `
      SELECT q.*, c.name as campaign_name 
      FROM email_queue q
      LEFT JOIN email_campaigns c ON q.campaign_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND q.status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (campaign_id) {
      query += ` AND q.campaign_id = $${paramIndex++}`;
      params.push(campaign_id);
    }

    query += ` ORDER BY q.scheduled_at ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const data = await executeQuery(query, params);

    // Also get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM email_queue WHERE 1=1`;
    const countParams: any[] = [];
    let countIndex = 1;
    
    if (status) { countQuery += ` AND status = $${countIndex++}`; countParams.push(status); }
    if (campaign_id) { countQuery += ` AND campaign_id = $${countIndex++}`; countParams.push(campaign_id); }
    
    const countData = await executeQuery(countQuery, countParams);
    const total = parseInt(countData[0]?.total || '0');

    return NextResponse.json({ success: true, data, pagination: { total, limit, offset } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
