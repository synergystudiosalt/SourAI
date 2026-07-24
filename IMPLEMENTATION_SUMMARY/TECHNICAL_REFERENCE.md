# Technical Reference - Implementation Details

## Component Exports & Imports

### EditPreview Component
```typescript
// File: src/components/EditPreview.tsx
import { EditPreview } from '../components/EditPreview';

// Props interface
interface EditPreviewProps {
  ops: AgentFileOp[];
  isDarkMode: boolean;
  onRejectAll: () => void;
  onKeepAll: () => void;
  messageId: string;
}

// Returns React.FC component with animations
```

### AgentPanel Updates
```typescript
// New imports added
import { AttachmentPopover } from '../AttachmentPopover';
import { Image as ImageIcon } from 'lucide-react';

// New state hooks
const [showAttachmentPopover, setShowAttachmentPopover] = useState(false);
const attachmentPopoverRef = useRef<HTMLDivElement>(null);

// New functions
const autoDetectAndCallFunctions = (userText: string) => {
  // Returns { promptToSend: string; autoCalledFunctions: string[] }
}

const shouldAutoSpawnSubagents = (userText: string) => {
  // Returns boolean
}
```

---

## Auto-Detection Patterns

### Pattern 1: ReadFile Detection
```typescript
// Triggered by keywords
/\b(read|view|show|open|check|display|cat|view.*file)\b/i

// Path extraction
/['\"]([\w.\/-]+[\.\w]+)['\"]|(?:the\s+)?file\s+([\w.\/-]+)|(src|app|lib|components)\/[\w.\/-]+/i

// Example transformations:
// Input: "read src/App.tsx"
// Output: "read src/App.tsx\n\n@@readfile: src/App.tsx"
```

### Pattern 2: FindAll Detection
```typescript
// Triggered by keywords
/\b(search|find|locate|grep|look for|where|detect)\b/i

// Search term extraction
/(?:for|"([^"]+)"|\s+([\w\s]+?)(?:\s+in|\?|$))/i

// Example transformations:
// Input: "find all hooks"
// Output: "find all hooks\n\n@@findall: hooks"
```

### Pattern 3: Complex Task Detection
```typescript
// Complexity thresholds
const sentenceCount = (userText.match(/[.!?]/g) || []).length;
const hasMultipleTopics = /\b(and|also|plus|additionally|furthermore)\b/i.test(userText);
const wordCount = userText.split(/\s+/).length;

// Trigger conditions
(wordCount > 60 && sentenceCount >= 2) || (hasMultipleTopics && sentenceCount >= 2)
```

---

## System Prompt Enhancements

### Code Quality Standards Structure
```
AGENT_SYSTEM_PROMPT now includes:

1. Type Safety (for TypeScript/Typed Languages) [10 points]
2. Error Handling & Validation [5 points]
3. Performance Optimization [6 points]
4. Security Best Practices [7 points]
5. Testing Approach [6 points]
6. Documentation & Comments [6 points]
7. Code Organization (DRY Principle) [6 points]
8. Accessibility (WCAG AA for UI) [6 points]
9. Environmental & Configuration [6 points]
10. Automatic Improvement Suggestions [5 points]
```

### Key Emphasis Areas
- CLEAN, PRODUCTION-READY code
- Type safety as first-class concern
- Automatic improvement suggestions (no user request needed)
- WCAG AA accessibility standards
- OWASP security guidelines
- >80% test coverage targets

---

## UI Integration Points

### EditPreview Component Location
When displayed in chat flow:
```
AgentPanel (workspace)
  ├─ Message List
  │  └─ renderMessage()
  │     └─ <EditPreview />  ← Component rendered here
  ├─ Sub-agent Orchestration UI
  └─ Input Area
```

### Image Upload Button Location
```
AgentPanel Input Area
├─ Model/Mode Controls
├─ Audio Button
├─ Image Button  ← New
├─ Send Button
└─ AttachmentPopover (appears when image button clicked)
```

---

## State Management

### EditPreview State
```typescript
// Local to EditPreview component
const [isExpanded, setIsExpanded] = useState(true);
// Smooth animation on toggle
```

### AgentPanel Attachment State
```typescript
// New state for image upload
const [showAttachmentPopover, setShowAttachmentPopover] = useState(false);
const attachmentPopoverRef = useRef<HTMLDivElement>(null);

// Click-outside detection via useEffect
useEffect(() => {
  if (!showAttachmentPopover) return;
  const onPointerDown = (e: MouseEvent) => {
    if (attachmentPopoverRef.current && 
        !attachmentPopoverRef.current.contains(e.target as Node)) {
      setShowAttachmentPopover(false);
    }
  };
  window.addEventListener('mousedown', onPointerDown);
  return () => window.removeEventListener('mousedown', onPointerDown);
}, [showAttachmentPopover]);
```

---

## Message Flow

### Auto-Detected Functions Message Flow
```
User Input: "read src/App.tsx"
    ↓
autoDetectAndCallFunctions()
    ↓
promptToSend: "read src/App.tsx\n\n@@readfile: src/App.tsx"
autoCalledFunctions: ["@@readfile"]
    ↓
displayContent: "read src/App.tsx\n\n_[Auto-called: @@readfile]_"
    ↓
AgentChatMessage { role: 'user', content: displayContent }
    ↓
Chat displays with auto-call notation
```

### Complex Task Spawning Flow
```
User Input: "Build a login form with email validation, password reset..."
    ↓
shouldAutoSpawnSubagents() → true
    ↓
Auto-spawn subagents for:
- Create login form component
- Add email validation
- Implement password reset flow
    ↓
displayContent includes "_[Complex task detected — spawning subagents...]_"
    ↓
Subagents run in parallel (up to MAX_CONCURRENT_SUBAGENTS)
```

---

## Keyboard Shortcuts

### From EditPreview Component
- **Alt+Shift+Y**: Keep all edits (calls onKeepAll)
- **Alt+Shift+Z**: Reject all edits (calls onRejectAll)

### From AgentPanel (Existing)
- **Enter**: Send message (unless in mention/slash command mode)
- **Escape**: Close mention menu / slash commands

### Future Recommendations
- **Ctrl+Shift+E**: Toggle EditPreview expansion
- **Ctrl+I**: Toggle image upload menu

---

## Styling & Theming

### EditPreview Theme
```typescript
// Dark mode
isDarkMode && 'bg-gray-800/50 border-gray-700/50 text-gray-100'

// Light mode
!isDarkMode && 'bg-gray-50 border-gray-200 text-gray-900'

// Color coding for diffs
added: 'text-green-500'
removed: 'text-red-500'
neutral: 'text-gray-500'
```

### Icons Used
```typescript
import {
  ChevronDown,      // Expand/collapse toggle
  ThumbsUp,         // Keep all button
  XCircle,          // Reject all button
  Image as ImageIcon, // Image upload button
  // ... existing icons
} from 'lucide-react';
```

---

## Performance Characteristics

### EditPreview
- **Render**: O(n) where n = number of files
- **Animation**: 60fps via Framer Motion
- **Memory**: Minimal (single component instance)

### Auto-Detection
- **Regex matching**: O(m) where m = message length (typically <500 chars)
- **Pattern checks**: 2 regex tests per message
- **Overhead**: <1ms for typical inputs

### Complex Task Detection
- **Word count**: O(m) via string split
- **Regex tests**: 2 regex tests
- **Total overhead**: <2ms

---

## Error Handling

### EditPreview
```typescript
// Graceful fallback
if (!ops || ops.length === 0) return null;

// Safe content access
const lines = (op.content || '').split('\n').length;
```

### Auto-Detection
```typescript
// Path extraction with fallback
const pathMatch = userText.match(...);
if (pathMatch) {
  // Use matched path
}
// If no match, no auto-call (safe)

// Search term validation
if (searchTerm && searchTerm[1]?.length < 50) {
  // Only call if valid search term found
}
```

---

## Browser Compatibility

All features are compatible with:
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Modern mobile browsers

### Optional Features
- Image upload: Uses File API (widely supported)
- ResizeObserver: For popover positioning
- RegExp: Standard JavaScript feature

---

## Bundle Size Impact

### New Additions
- EditPreview component: ~2KB
- Smart function logic: <1KB
- Regex patterns: <1KB
- **Total**: ~4KB (minified)

### Reused Dependencies
- `motion` (framer-motion): Already included
- `lucide-react`: Already included
- `AttachmentPopover`: Already exists

**No new dependencies required!**

---

## Configuration & Customization

### Auto-Detection Sensitivity
To adjust complexity threshold for subagent spawning:
```typescript
// In shouldAutoSpawnSubagents()
const wordCount = userText.split(/\s+/).length;
return (wordCount > 60 && sentenceCount >= 2); // ← Adjust 60
```

### Pattern Keyword Lists
To add/remove keywords for auto-detection:
```typescript
// Pattern 1 keywords
/\b(read|view|show|open|check|display|cat|view.*file)\b/i

// Pattern 2 keywords
/\b(search|find|locate|grep|look for|where|detect)\b/i
```

---

## Logging & Debugging

### Recommended Debug Points
```typescript
// Log auto-detected functions
console.log('Auto-called functions:', autoCalledFunctions);

// Log complex task detection
console.log('Spawning subagents:', shouldSpawnSubagents);

// Log image attachment
console.log('Image attached:', item.name);
```

### Development Helpers
```typescript
// In AgentPanel component
// Set these to log detailed info
const DEBUG_AUTO_DETECTION = false;
const DEBUG_COMPLEX_TASKS = false;
const DEBUG_IMAGE_UPLOAD = false;
```

---

## Maintenance Notes

- **Regex patterns**: Keep up-to-date with common user phrasing
- **Keyword lists**: May need expansion based on user feedback
- **Complexity thresholds**: Monitor subagent spawn rates
- **System prompt**: Review and update with agent capability changes
