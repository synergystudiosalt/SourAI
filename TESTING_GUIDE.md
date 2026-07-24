# sour.ai Improvements Testing Guide

This guide provides detailed steps to validate all improvements across the 5 tasks.

---

## Task 1: Mobile Responsiveness Testing

### Prerequisites
- Browser DevTools (F12)
- A mobile device (optional but recommended)

### Test Procedure

#### 1.1 Mobile Breakpoint (320px)

1. Open Chrome DevTools (F12)
2. Click Device Toolbar icon (Ctrl+Shift+M)
3. Set width to 320px (iPhone SE)
4. Verify:
   - [ ] TopBar shows hamburger menu
   - [ ] LeftSidebar icon bar is HIDDEN
   - [ ] AgentPanel takes full width
   - [ ] All text is readable (no overflow)
   - [ ] Buttons are touch-sized (min 44x44px)
   - [ ] No horizontal scrolling

#### 1.2 Small Tablet (640px)

1. Set device width to 640px
2. Verify:
   - [ ] Hamburger menu still visible
   - [ ] Spacing is improved
   - [ ] AgentPanel still stacks
   - [ ] Text sizes increase (sm: breakpoint active)
   - [ ] Sidebar drawer works

#### 1.3 Tablet (768px)

1. Set device width to 768px
2. Verify:
   - [ ] LeftSidebar icon bar appears
   - [ ] AgentPanel still full width OR starts collapsing
   - [ ] All UI elements visible
   - [ ] Drawer behavior transitions smoothly

#### 1.4 Desktop (1024px+)

1. Set device width to 1024px
2. Verify:
   - [ ] Full layout with all sidebars visible
   - [ ] LeftSidebar expands/collapses smoothly
   - [ ] AgentPanel has proper width (lg:w-72)
   - [ ] Spacing is optimal for productivity
   - [ ] No elements cut off

#### 1.5 Real Mobile Device

1. Access localhost on iPhone/Android
2. Verify:
   - [ ] Touch interactions work
   - [ ] No pinch-to-zoom needed
   - [ ] Buttons are clickable
   - [ ] Scrolling is smooth
   - [ ] Landscape mode works
   - [ ] Status bar doesn't interfere

### Success Criteria
- ✅ All breakpoints render correctly
- ✅ No horizontal scrolling at any size
- ✅ Text is readable without zoom
- ✅ Touch targets are appropriately sized
- ✅ Smooth transitions between breakpoints

---

## Task 2: Visual Function Call Indicators Testing

### Test Components
- File read indicator (blue)
- Search indicator (purple)
- Subagent indicator (green)

### Test Procedure

#### 2.1 Indicator Rendering

1. Look at chat window where agent is responding
2. Watch for indicators appearing before results
3. Verify:
   - [ ] File read indicator shows blue with File icon
   - [ ] Search indicator shows purple with Search icon
   - [ ] Subagent indicator shows green with Bot icon
   - [ ] Indicators appear inline in chat
   - [ ] Text is readable next to icons

#### 2.2 Animation States

1. Monitor different indicator states:

   **Pending State**:
   - [ ] Icon pulses with opacity animation
   - [ ] Text remains stable
   - [ ] Smooth timing (~1.5s cycle)

   **Running State**:
   - [ ] Icon spins smoothly
   - [ ] "…" appended to text
   - [ ] Continuous smooth rotation

   **Complete State**:
   - [ ] Checkmark appears
   - [ ] Text shows result count if available
   - [ ] Scale-in animation visible
   - [ ] Color changes to green

   **Error State**:
   - [ ] Red alert icon appears
   - [ ] Subtle shake animation
   - [ ] Error message displays

#### 2.3 Multiple Indicators

1. Trigger request with multiple operations
2. Verify:
   - [ ] Multiple indicators appear staggered
   - [ ] Each has own animation timing
   - [ ] No overlap or collision
   - [ ] All remain readable
   - [ ] Layout flows naturally

#### 2.4 Performance

1. Trigger several indicators rapidly
2. Verify:
   - [ ] Animations remain smooth
   - [ ] No frame drops
   - [ ] CPU usage reasonable
   - [ ] Memory doesn't leak

### Success Criteria
- ✅ All indicator types render correctly
- ✅ All animation states work smoothly
- ✅ Multiple indicators display properly
- ✅ Performance remains good

---

## Task 3: Intelligent Subagent Usage Testing

### Test Cases

#### 3.1 Multi-Part Task Detection

1. Send request: "Create a Button component and write tests for it and add documentation"
2. Verify:
   - [ ] Subagents automatically detected
   - [ ] 3 sub-tasks appear in SubAgents section
   - [ ] Tasks are logically divided
   - [ ] Each task is self-contained

#### 3.2 Complexity Estimation

1. Send simple request: "Fix the button color"
   - [ ] No subagents spawned
   
2. Send complex request: "Refactor the entire auth system with tests, docs, and optimizations"
   - [ ] Subagents automatically spawned
   - [ ] 3+ subagents running in parallel

#### 3.3 Parallel Execution

1. Request with multiple tasks spawns subagents
2. Verify:
   - [ ] SubAgent status section appears
   - [ ] Shows "Sub-agents (X/4 active)"
   - [ ] Task indicators show status (queued/running/done)
   - [ ] Progress updates in real-time
   - [ ] Max 4 agents run simultaneously

#### 3.4 Task Completion

1. Monitor subagent completion
2. Verify:
   - [ ] Status changes from "running" to "done"
   - [ ] File count appears when complete
   - [ ] Messages appear in chat
   - [ ] UI updates show applied changes

#### 3.5 Error Handling

1. Force an error in a subagent task
2. Verify:
   - [ ] Error status appears
   - [ ] Error message visible
   - [ ] Other subagents continue
   - [ ] Recovery is possible

### Example Trigger Phrases
- "Create [X], write tests for it, and update the README"
- "Refactor [module] and add comprehensive documentation"
- "Build [feature] and create unit tests and update docs"
- "Fix [bug], optimize [section], and improve [area]"

### Success Criteria
- ✅ Multi-part tasks detected automatically
- ✅ Subagents spawned when appropriate
- ✅ Parallel execution works correctly
- ✅ Progress tracking is accurate
- ✅ Max concurrent agents (4) enforced

---

## Task 4: UI Theme & Design Testing

### Test Procedure

#### 4.1 Light Mode

1. Ensure light mode is active
2. Verify colors:
   - [ ] Background: #faf9f6 (warm white)
   - [ ] Primary text: #1c1b1a (dark)
   - [ ] Sidebar: Light beige tones
   - [ ] Accent: #d96b43 (burnt orange)
   - [ ] Buttons: Proper contrast

3. Test typography:
   - [ ] Headings use Instrument Serif
   - [ ] Body text uses Plus Jakarta Sans
   - [ ] Sizes scale properly
   - [ ] Line heights are readable

4. Test components:
   - [ ] Buttons have clear states
   - [ ] Hover effects smooth
   - [ ] Focus states visible
   - [ ] Disabled states clear
   - [ ] Shadows subtle but present

#### 4.2 Dark Mode

1. Toggle to dark mode (theme button)
2. Verify colors:
   - [ ] Background: #181817 (dark)
   - [ ] Primary text: #f0efe6 (light)
   - [ ] Sidebar: Dark grays
   - [ ] Accent: #ff8a65 (lighter orange)
   - [ ] Proper contrast maintained

3. Test readability:
   - [ ] No eye strain
   - [ ] Text clearly readable
   - [ ] Colors not too bright
   - [ ] Suitable for low-light use

#### 4.3 Transitions

1. Move mouse over buttons
2. Verify:
   - [ ] Hover effects transition smoothly
   - [ ] Duration ~150-200ms
   - [ ] Easing feels natural
   - [ ] No jarring color changes

3. Test animations:
   - [ ] Modal open/close smooth
   - [ ] Chat messages fade in
   - [ ] Indicators appear smoothly
   - [ ] All animations ~200-300ms

#### 4.4 Consistency

1. Check all components:
   - [ ] Buttons consistent style
   - [ ] Input fields consistent
   - [ ] Cards consistent shadows
   - [ ] Spacing consistent
   - [ ] Borders consistent width

2. Check color usage:
   - [ ] Accent color used consistently
   - [ ] Semantic colors (success/error) consistent
   - [ ] Text colors consistent
   - [ ] Border colors consistent

#### 4.5 Accessibility

1. Check contrast ratios:
   - [ ] Text vs background ≥ 4.5:1
   - [ ] All text readable
   - [ ] Color not only differentiator
   - [ ] Focus states visible

### Success Criteria
- ✅ Light mode looks professional
- ✅ Dark mode is comfortable
- ✅ Transitions are smooth
- ✅ Colors are consistent
- ✅ Accessibility standards met

---

## Task 5: Improved Agent Quality Testing

### Test Procedure

#### 5.1 Smart Code Suggestions

1. Request: "Create a utility function that validates email"
2. Verify agent response:
   - [ ] Function is well-structured
   - [ ] Includes error handling
   - [ ] Has clear comments
   - [ ] Follows existing code style
   - [ ] Suggests related utilities

#### 5.2 Test Generation

1. Request: "Create a function that calculates tax"
2. Verify response includes:
   - [ ] Suggested unit tests
   - [ ] Edge cases mentioned
   - [ ] Error scenarios included
   - [ ] Tests follow project patterns
   - [ ] Tests are maintainable

#### 5.3 Documentation

1. Request: "Create a new API endpoint for users"
2. Verify response includes:
   - [ ] JSDoc comments suggested
   - [ ] Parameter types documented
   - [ ] Return type documented
   - [ ] Usage examples provided
   - [ ] README updates suggested

#### 5.4 Error Handling

1. Request: "Fix this error: Cannot read property 'map' of undefined"
2. Verify response:
   - [ ] Explains the error clearly
   - [ ] Shows root cause
   - [ ] Suggests defensive checks
   - [ ] Provides solution code
   - [ ] Explains why error occurred

#### 5.5 Refactoring

1. Provide code with duplication
2. Request: "Refactor this to reduce duplication"
3. Verify response:
   - [ ] Identifies duplicated logic
   - [ ] Suggests extraction
   - [ ] Shows before/after
   - [ ] Explains benefits
   - [ ] Maintains functionality

#### 5.6 Best Practices

1. Request: "Review this code for best practices"
2. Verify response identifies:
   - [ ] Code smells
   - [ ] Performance issues
   - [ ] Security concerns
   - [ ] Maintainability improvements
   - [ ] Modern alternatives

### Example Test Requests
- "Create a debounce utility with tests"
- "Fix the memory leak in this useEffect"
- "Refactor this React component for performance"
- "Create an API response handler with error handling"

### Success Criteria
- ✅ Code suggestions are IDE-quality
- ✅ Tests are suggested appropriately
- ✅ Documentation is comprehensive
- ✅ Error explanations are clear
- ✅ Refactoring suggestions are valuable

---

## Integration Testing

### Full Workflow Test

1. **Create full responsive workflow**:
   - Start on 320px mobile
   - Open hamburger menu
   - Send multi-part request
   - Watch for indicators
   - Observe subagents spawning
   - Resize to 1024px
   - Verify all still works
   - Toggle dark mode
   - Verify colors correct

2. **Verify all elements work together**:
   - [ ] Mobile UI responsive
   - [ ] Indicators show during agent work
   - [ ] Subagents run in parallel
   - [ ] Theme consistent throughout
   - [ ] Agent quality improved

### Performance Test

1. Send rapid requests
2. Monitor:
   - [ ] Smooth animations
   - [ ] No frame drops
   - [ ] CPU usage reasonable
   - [ ] Memory stable
   - [ ] Responsive to input

### Device Testing

Test on:
- [ ] iPhone (320px portrait)
- [ ] iPhone (375px portrait)
- [ ] iPad (768px portrait)
- [ ] iPad (1024px landscape)
- [ ] Desktop (1920px)
- [ ] Touch device
- [ ] Keyboard-only navigation

---

## Regression Testing

Verify existing functionality still works:

- [ ] Chat messages send/receive
- [ ] File operations apply correctly
- [ ] Code editing works
- [ ] File explorer functions
- [ ] Settings persist
- [ ] Dark mode persists
- [ ] Conversation history saved
- [ ] Model selection works
- [ ] Voice input works
- [ ] Attachments upload

---

## Success Metrics

### Quantitative
- Frame rate: ≥ 60fps during animations
- Interaction latency: <100ms for UI feedback
- Mobile load time: <3 seconds
- Agent response quality: High (subjective)

### Qualitative
- UI feels polished and professional
- Responsive design feels natural
- Indicators are helpful and not distracting
- Subagent execution is seamless
- Code quality suggestions are valuable

---

## Known Limitations & Future Improvements

### Current Limitations
1. Subagent detection uses simple keyword matching
2. Visual indicators don't show detailed progress
3. Theme must be selected per browser (not synced)
4. Mobile experience good but not optimized for every phone

### Planned Enhancements
1. ML-based task detection for subagents
2. Detailed progress bars for long operations
3. Cross-device theme persistence
4. Phone-specific optimizations

---

## Troubleshooting

### Mobile not responsive
- [ ] Clear browser cache
- [ ] Refresh page
- [ ] Check DevTools device emulation
- [ ] Verify viewport meta tag in index.html

### Indicators not showing
- [ ] Check browser console for errors
- [ ] Verify agent is making function calls
- [ ] Check motion/react is loaded
- [ ] Verify lucide-react icons available

### Subagents not spawning
- [ ] Use multi-part request format
- [ ] Check agent console output
- [ ] Verify MAX_CONCURRENT_SUBAGENTS is set
- [ ] Try different trigger phrases

### Theme not changing
- [ ] Verify dark mode toggle working
- [ ] Check localStorage for theme setting
- [ ] Refresh page after toggle
- [ ] Check CSS dark: classes applied

### Agent not suggesting improvements
- [ ] Provide complete code context
- [ ] Use specific request phrases
- [ ] Check system prompt loaded
- [ ] Verify selected model supports features

---

## Sign-Off Checklist

- [ ] All 5 tasks tested
- [ ] No major bugs found
- [ ] Performance acceptable
- [ ] Responsive at all breakpoints
- [ ] Theme working both modes
- [ ] Agent quality improved
- [ ] Ready for production

---

## Contact & Support

For test failures or issues:
1. Check this guide for similar scenarios
2. Review IMPROVEMENTS.md for details
3. Check source code comments
4. Open DevTools console for errors
5. Compare with expected behavior

---

Generated: 2024-07-24
Version: 4.5
