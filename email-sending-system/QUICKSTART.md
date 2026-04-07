# Email Sequences - Quick Start Guide

## 🚀 Get Started in 3 Steps

### Step 1: Set up the database
```bash
cd email-sending-system
node scripts/run-sequence-migration.js
```

Expected output:
```
✅ Email sequences migration completed successfully!
📋 Created tables:
   - email_sequences
   - email_sequence_items
```

### Step 2: Start the server
```bash
npm run dev
```

Server will start at: `http://localhost:3000`

### Step 3: Open the Sequences page
Navigate to: `http://localhost:3000/sequences`

## 📚 What You Can Do

### Create a Sequence
1. Click "New Sequence" button
2. Enter name (e.g., "Welcome Series")
3. Add description (optional)
4. Click "Save"

### Add Emails to Your Sequence
1. Click on the sequence card to expand it
2. Click "Add Email" button
3. Select a template from the dropdown
4. Set delay (days and/or hours)
5. Click "Save"
6. Repeat for more emails

### Reorder Emails
1. Expand the sequence
2. Hover over any email item
3. Use up/down arrows to reorder

### Manage Sequences
- **Edit**: Click "Edit" button to modify name/description
- **Activate/Deactivate**: Toggle the active status button
- **Delete**: Click "Delete" to remove the sequence

## 🎯 Example: Create a Welcome Sequence

```
Sequence: Welcome Series
Description: 5-part onboarding for new users

Emails:
1. Welcome Email → Delay: Immediate (0d 0h)
2. Getting Started → Delay: 1 day (1d 0h)
3. Feature Highlights → Delay: 3 days (3d 0h)
4. Advanced Tips → Delay: 7 days (7d 0h)
5. Feedback Request → Delay: 14 days (14d 0h)

Total Duration: 25 days
```

## 🔗 API Endpoints

For programmatic access:

```bash
# Get all sequences
GET /api/sequences

# Create sequence
POST /api/sequences
Body: { "name": "My Sequence", "description": "..." }

# Update sequence
PUT /api/sequences
Body: { "id": "uuid", "name": "Updated", ... }

# Delete sequence
DELETE /api/sequences?id={uuid}

# Add item to sequence
POST /api/sequences/{id}/items
Body: { "template_id": "uuid", "delay_days": 1, "delay_hours": 0 }

# Update item position
PUT /api/sequences/{id}/items
Body: { "item_id": "uuid", "position": 2 }

# Remove item from sequence
DELETE /api/sequences/{id}/items?item_id={uuid}
```

## 🧪 Test the API

```bash
node scripts/test-sequences-api.js
```

## 📖 Full Documentation

See `SEQUENCES_README.md` for complete documentation including:
- Detailed API reference
- Usage examples
- Best practices
- Troubleshooting guide

## 🆘 Troubleshooting

### "No templates available"
- Go to Templates page first
- Create some email templates
- Then add them to sequences

### "Migration failed"
- Check that DATABASE_URL is set in .env
- Verify database is accessible
- Check database permissions

### "Can't add items to sequence"
- Make sure templates exist first
- Refresh the page
- Check browser console for errors

## 💡 Tips

1. **Plan Your Sequence**: Map out the email flow before creating
2. **Start Simple**: Begin with 2-3 emails, then expand
3. **Test Delays**: Use shorter delays initially for testing
4. **Use Clear Names**: Name sequences and templates clearly
5. **Test Thoroughly**: Activate only after testing all emails

## ✨ You're Ready!

The email sequences system is now ready to use. Start creating your first sequence and automate your email campaigns! 🎉
