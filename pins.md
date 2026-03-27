# T3-Code Fork - Improvement Pins

## Active (Working On Now)

- [ ] Skills/Slash commands — make installed plugins (superpowers, frontend-design) work with `/` in chat composer
- [ ] Terminal rendering — fix powerline/nerd font glyphs, fish shell prompt rendering in xterm.js
- [ ] Terminal UX — fix messy terminal access, CWD persistence across restarts

## Queued (Next Up)

- [ ] Context viewer panel — show CLAUDE.md, project settings, memory files in a sidebar
- [ ] Context editor — built-in text editor for CLAUDE.md and settings files
- [ ] Conversation browser — scan ~/.claude/projects/ and show resumable sessions
- [ ] `claude --resume` support — pick a session from browser, launch in terminal pane

## Backlog (Future)

- [ ] Pane system from Nmux — split panes with vim-style navigation, nested layouts
- [ ] Session persistence & crash recovery (Nmux-style)
- [ ] Cross-project workspace browser
- [ ] Settings editor for ~/.claude/settings.json and project .claude/settings.json
- [ ] Memory browser — navigate and edit memory files
- [ ] Active sessions monitor — show what claude instances are running
- [ ] Department-aware context switching (Nano's department CLAUDE.md structure)
- [ ] Notification system with per-pane attention tracking
- [ ] IPC protocol for external tool integration

## Notes

- t3.code uses Claude Agent SDK `query()` directly, not the CLI
- Skills work by injecting SKILL.md content into the prompt
- Nmux source at ~/Documents/Nmux has reusable patterns (layout algorithm, conversation discovery, IPC)
- Terminal uses xterm.js — needs font configuration for nerd fonts
- Fish shell is the user's default shell
