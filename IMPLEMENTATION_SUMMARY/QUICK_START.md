# Quick Start Guide - Using the New Features

## Feature 1: Edit Preview Component

### What You'll See
When the agent generates code changes, a preview will appear **above the chat input**:

```
┌─ Edits • 3 files • +45 -12 ─────────────────────┐
│ ⬇ Edits • 3 files • +45 -12  [👍] [✖]          │
│                                                  │
│   ▾ src/App.tsx                           +23   │
│   ▾ src/utils/helper.ts                   +22   │
│   ✕ src/old-file.ts                     delete  │
└──────────────────────────────────────────────────┘
```

### How to Use
1. **View changes**: Expand/collapse the preview by clicking the header
2. **Keep all**: Click the green thumbs-up button to accept all changes
3. **Reject all**: Click the red X button to reject all changes
4. **Individual control**: Click "Apply" or "Reject" on each file

### Keyboard Shortcuts
- **Alt+Shift+Y**: Keep all changes
- **Alt+Shift+Z**: Reject all changes

---

## Feature 2: Better AI Coding Instructions

### What's Improved
The agent now **automatically**:

✅ Enforces strict type safety (no `any` types)  
✅ Suggests error handling for every function  
✅ Points out security issues  
✅ Recommends tests for critical code  
✅ Adds JSDoc documentation  
✅ Suggests performance optimizations  
✅ Ensures WCAG AA accessibility  
✅ Guides environment variable usage  

### Example Results
**Before**: Generic code without considerations  
**After**: Production-ready code with:
- Full type definitions
- Try/catch error handling
- Input validation
- Security checks
- Test suggestions
- Accessibility notes

### What You Should Ask
```
"Create a login form"
```

The agent will:
1. Build the form component
2. Add email validation
3. Handle password securely
4. Suggest tests for validation
5. Add WCAG AA accessibility features
6. Document all parameters

---

## Feature 3: Subagent Image Upload & Smart Functions

### Image Upload

#### How to Use
1. Click the **image icon** (🖼️) in the input toolbar
2. Select an image from your device
3. The image appears in your message: `[Image: filename.png]`
4. Send your message - the agent receives the visual context

#### What Works
- Screenshots for UI feedback
- Diagrams for architecture questions
- Mockups for design implementation
- Photos of code on paper
- Any visual reference

---

### Smart Function Auto-Calling

#### What It Does
Instead of typing `@@readfile` or `@@findall`, the agent detects your intent:

#### Example 1: Read a File
```
You type:     "read src/App.tsx"
Agent sends:  "read src/App.tsx\n\n@@readfile: src/App.tsx"
Chat shows:   _[Auto-called: @@readfile]_
```

#### Example 2: Search for Code
```
You type:     "find all imports"
Agent sends:  "find all imports\n\n@@findall: import"
Chat shows:   _[Auto-called: @@findall]_
```

#### Example 3: Complex Task
```
You type:     "Build a complete auth system with login, signup, 
               password reset, email verification, and JWT tokens"
Result:       _[Complex task detected — spawning subagents for parallel work]_
```

The agent spawns independent subagents for:
- Login component
- Signup component  
- Password reset flow
- Email verification system
- JWT implementation

### Supported Keywords

#### For `@@readfile`:
- read, view, show, open, check, display, cat

#### For `@@findall`:
- search, find, locate, grep, look for, where, detect

### What Gets Auto-Called

**✓ Auto-called without user request:**
- `@@readfile` when you ask to read a file
- `@@findall` when you search for code
- Sub-agents when task is complex

**✗ Not auto-called:**
- Sub-agents for simple, focused tasks
- Functions when you already use `@@` prefix

---

## Common Workflows

### Workflow 1: Review and Accept Changes

```
1. You: "Add error handling to utils.ts"
2. Agent generates code
3. EditPreview shows: "Edits • 1 file • +18 -2"
4. You review the changes in the preview
5. You click 👍 "Keep All" or Alt+Shift+Y
6. Changes applied automatically
```

### Workflow 2: Search and Understand Code

```
1. You: "find all API calls"
   (Agent auto-calls: @@findall: API)
2. Agent shows all matching lines
3. You: "read src/api/client.ts"
   (Agent auto-calls: @@readfile)
4. Agent displays full file content
5. You: "explain how this works"
6. Agent provides explanation based on context
```

### Workflow 3: Visual Reference with Image

```
1. You upload a screenshot of a design
2. You: "Build this UI component"
3. Agent analyzes the image
4. Agent generates code matching the design
5. EditPreview shows changes
6. You accept changes
```

### Workflow 4: Complex Multi-Part Task

```
1. You: "Build a React todo app with database sync,
          local storage fallback, and real-time updates
          with WebSocket. Add user authentication.
          Include unit tests for all logic."
2. Agent detects complexity → spawns subagents:
   ⟳ Todo component (running)
   ⟳ Database sync logic (queued)
   ⟳ WebSocket implementation (queued)
   ⟳ Auth integration (queued)
   ⟳ Unit tests (queued)
3. Subagents work in parallel
4. All changes gathered into EditPreview
5. You review and accept
```

---

## Tips & Best Practices

### For Edit Preview
- ✅ Always review changes before accepting
- ✅ Use "Reject All" if output doesn't match expectations
- ✅ Check dark mode rendering matches your theme
- ✅ Watch for file count mismatches (expect ~2-3 files per task)

### For Better Code Quality
- ✅ Mention specific requirements (security, performance, accessibility)
- ✅ Ask for test suggestions explicitly
- ✅ Ask for documentation when needed
- ✅ Reference existing code patterns in your project
- ✅ Mention target browser support

### For Auto-Detected Functions
- ✅ Use natural language, not `@@` syntax
- ✅ Include filenames or search terms clearly
- ✅ Break complex requests into manageable pieces
- ✅ Trust the agent's complexity detection
- ✅ Check the "_[Auto-called: ...]_" notation to verify

### For Image Uploads
- ✅ Use for visual design references
- ✅ Include screenshots with context
- ✅ Keep images reasonably sized (<5MB)
- ✅ Combine with text descriptions
- ✅ Use for UI mockups and diagrams

---

## Troubleshooting

### EditPreview Not Appearing
- Ensure the agent generates code changes (ops)
- Check that `isDarkMode` prop is passed correctly
- Verify file operations have valid paths

### Auto-Detected Functions Not Working
- Use clear keywords (read, find, search, locate)
- Include the target file/search term
- Check the chat for `_[Auto-called: ...]_` notation
- If not triggered, use `@@` prefix manually

### Image Upload Button Missing
- Ensure you're in the subagent input area
- Check that `AttachmentPopover` is imported
- Verify `showAttachmentPopover` state exists
- Look for the 🖼️ icon next to voice button

### Complex Task Not Spawning Subagents
- Task may be too simple (word count < 60)
- May need explicit multiple topics (and, also, plus)
- Check that sentence count >= 2
- Try being more explicit: "Create X, implement Y, add Z"

---

## Configuration Options

### To Change Subagent Complexity Threshold
Edit `src/components/workspace/AgentPanel.tsx`:
```typescript
const shouldAutoSpawnSubagents = (userText: string): boolean => {
  const wordCount = userText.split(/\s+/).length;
  return wordCount > 60; // Change 60 to adjust sensitivity
};
```

### To Add New Auto-Detection Keywords
Edit auto-detection patterns:
```typescript
// Add your keywords to the regex patterns
/\b(read|view|show|open|check|display|cat|your_keyword)\b/i
```

### To Disable Auto-Detection
In `handleSend()`:
```typescript
// Comment out this line to disable auto-detection
const { promptToSend, autoCalledFunctions } = autoDetectAndCallFunctions(text);
// Use original text instead
const promptToSend = text;
```

---

## Examples

### Example 1: Full Workflow
```
User: "Build a React component for a user profile card that shows 
       avatar, name, bio, and social links. It should be responsive 
       and accessible. Check if we have image utility functions."

Agent AI Analysis:
- Detects: complexity + readfile pattern
- Auto-calls: @@findall: image utility
- Spawns: subagent for component, subagent for styles
- Chat shows: _[Auto-called: @@findall]_
              _[Complex task detected — spawning subagents for parallel work]_

Result:
- File 1: ProfileCard.tsx (with JSDoc, error handling, accessibility)
- File 2: profileCard.module.css (responsive styles)
- File 3: __tests__/ProfileCard.test.tsx (unit tests suggested)

EditPreview shows:
Edits • 3 files • +127 -0

You: Click 👍 "Keep All" → Changes applied!
```

### Example 2: Image-Based Design
```
User: (uploads screenshot of design mockup)
      "Build this exact UI, use Tailwind CSS"

Agent:
- Analyzes the image
- Generates matching component
- Adds responsive design
- Suggests accessibility improvements

EditPreview shows matching component with styling
```

### Example 3: Search and Learn
```
User: "find database queries"

Agent:
- Auto-calls: @@findall: query
- Shows all database query matches
- User can then ask: "read db/queries.ts"
- Agent auto-calls: @@readfile: db/queries.ts
- Full file displayed for analysis
```

---

## Next Steps

1. **Try the EditPreview**: Ask agent to generate code changes
2. **Use auto-detection**: Say "read src/main.tsx" instead of `@@readfile`
3. **Upload an image**: Use design mockup for visual reference
4. **Request complex features**: Let subagents work in parallel
5. **Review code quality**: Notice type safety, error handling, tests

Happy coding! 🚀
