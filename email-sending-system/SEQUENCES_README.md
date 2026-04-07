# Email Sequences Management System

## Overview

The Email Sequences Management System allows you to create ordered email campaigns with automated delays between emails. This is perfect for welcome series, sales follow-ups, onboarding sequences, and more.

## Features

- **Create Sequences**: Build email sequences with custom names and descriptions
- **Add Templates**: Add email templates to sequences in specific order
- **Configure Delays**: Set delays between emails (days and hours)
- **Reorder Emails**: Drag-and-drop or use up/down controls to reorder templates
- **Toggle Active/Inactive**: Activate or deactivate sequences without deleting them
- **Visual Flow**: See the complete sequence flow with delay indicators
- **Delete with Confirmation**: Safely delete sequences with confirmation dialogs

## Installation

### 1. Run Database Migration

```bash
cd email-sending-system
node scripts/run-sequence-migration.js
```

This will create the following tables:
- `email_sequences` - Main sequences table
- `email_sequence_items` - Sequence items (templates within sequences)

### 2. Start the Development Server

```bash
npm run dev
```

### 3. Access the Sequences Page

Navigate to: `http://localhost:3000/sequences`

## Database Schema

### email_sequences

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(255) | Sequence name |
| description | TEXT | Sequence description |
| is_active | BOOLEAN | Active status |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### email_sequence_items

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| sequence_id | UUID | Foreign key to email_sequences |
| template_id | UUID | Foreign key to email_templates |
| position | INTEGER | Order in sequence |
| delay_days | INTEGER | Days to wait after previous email |
| delay_hours | INTEGER | Hours to wait after previous email |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

## API Endpoints

### Sequences

#### GET /api/sequences
Fetch all sequences with their template items

Query Parameters:
- `include_inactive` (boolean) - Include inactive sequences

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Welcome Series",
      "description": "Onboarding sequence for new users",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "items": [...]
    }
  ]
}
```

#### POST /api/sequences
Create a new sequence

Request Body:
```json
{
  "name": "Welcome Series",
  "description": "Onboarding sequence",
  "is_active": true
}
```

#### PUT /api/sequences
Update a sequence

Request Body:
```json
{
  "id": "uuid",
  "name": "Updated Name",
  "description": "Updated description",
  "is_active": false
}
```

#### DELETE /api/sequences?id={uuid}
Delete a sequence (cascades to items)

### Sequence Items

#### GET /api/sequences/{id}/items
Get all items in a sequence

#### POST /api/sequences/{id}/items
Add a template to a sequence

Request Body:
```json
{
  "template_id": "uuid",
  "delay_days": 2,
  "delay_hours": 0
}
```

#### PUT /api/sequences/{id}/items
Update item position or delay

Request Body:
```json
{
  "item_id": "uuid",
  "position": 1,
  "delay_days": 1,
  "delay_hours": 0
}
```

#### DELETE /api/sequences/{id}/items?item_id={uuid}
Remove an item from a sequence

## Usage Examples

### Example 1: Create a Welcome Sequence

1. Navigate to `/sequences`
2. Click "New Sequence"
3. Enter name: "Welcome Series"
4. Enter description: "5-part onboarding sequence"
5. Click "Save"

### Example 2: Add Emails to Sequence

1. Expand the sequence card
2. Click "Add Email"
3. Select template: "Welcome Email #1"
4. Set delay: 0 days, 0 hours (immediate)
5. Click "Save"
6. Repeat for subsequent emails with appropriate delays

### Example 3: Reorder Emails

1. Expand the sequence card
2. Hover over an email item
3. Click up/down arrows to reorder
4. The position automatically updates

## UI Features

### Sequence Cards

Each sequence displays:
- Name and description
- Active/inactive status badge
- Email count
- Total duration (sum of all delays)
- Expandable details showing all emails in order

### Email Items

Each email in a sequence shows:
- Position number (1, 2, 3...)
- Template name and subject
- Delay indicator (e.g., "2d 4h" or "Immediate")
- Reorder controls (up/down arrows)
- Remove button

### Modals

- **Create Sequence**: Modal with name and description fields
- **Edit Sequence**: Modal to update sequence details
- **Delete Confirmation**: Safety confirmation before deletion
- **Add Email**: Modal with template selector and delay inputs

## Best Practices

### 1. Sequence Planning
- Plan your sequence flow before creating
- Consider the optimal timing between emails
- Test delays with a small segment first

### 2. Template Management
- Create templates first in the Templates page
- Use descriptive template names for easy identification
- Keep templates focused on single topics

### 3. Delay Configuration
- Start with shorter delays (1-2 days)
- Increase delay duration for later emails
- Consider timezone differences when setting hours

### 4. Sequence Organization
- Use clear, descriptive names
- Add detailed descriptions for team members
- Activate/deactivate instead of deleting when testing

## Common Workflows

### Creating a Sales Follow-up Sequence

1. Create sequence "Sales Follow-up"
2. Add emails with these delays:
   - Email 1: Immediate (lead capture)
   - Email 2: 1 day delay
   - Email 3: 3 days delay
   - Email 4: 7 days delay
   - Email 5: 14 days delay

### Creating a Welcome Series

1. Create sequence "Welcome Series"
2. Add emails with these delays:
   - Email 1: Immediate (welcome + login info)
   - Email 2: 1 day delay (getting started guide)
   - Email 3: 3 days delay (feature highlights)
   - Email 4: 7 days delay (advanced tips)
   - Email 5: 14 days delay (request feedback)

## Technical Details

### Automatic Position Management

When you add a template to a sequence, it automatically gets the next available position. When you reorder items, the system automatically repositions all affected items to maintain the correct order.

### Cascade Deletion

When you delete a sequence, all associated items are automatically deleted due to the `ON DELETE CASCADE` constraint.

### Timestamp Tracking

Both sequences and items automatically track `created_at` and `updated_at` timestamps using database triggers.

### Performance

Indexes are created on:
- `email_sequences.is_active`
- `email_sequences.created_at`
- `email_sequence_items.sequence_id`
- `email_sequence_items.template_id`
- `email_sequence_items.position`

## Troubleshooting

### Issue: Can't add items to sequence
**Solution**: Make sure you have created templates first in the Templates page

### Issue: Items not showing in correct order
**Solution**: Try refreshing the page. The position is automatically recalculated on reorder.

### Issue: Delete button not working
**Solution**: Check browser console for errors. Ensure you have the necessary permissions.

### Issue: Migration fails
**Solution**: Verify DATABASE_URL is set correctly in `.env` file and the database is accessible.

## Future Enhancements

Potential features for future versions:
- Drag-and-drop reordering interface
- Sequence templates (pre-built sequences)
- A/B testing within sequences
- Sequence analytics (open rates, click rates)
- Duplicate sequence functionality
- Export/import sequences
- Sequence preview mode
- Bulk edit delays
