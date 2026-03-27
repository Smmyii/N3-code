import { FitAddon } from "@xterm/addon-fit";
import {
  FileText,
  Plus,
  Settings,
  SquareSplitHorizontal,
  TerminalSquare,
  Trash2,
  XIcon,
} from "lucide-react";
import { type ThreadId } from "@t3tools/contracts";
import { Terminal, type ITheme } from "@xterm/xterm";
// TODO: re-enable when file editor feature lands (feat/file-editor branch)
// import ContextViewerPanel from "./ContextViewerPanel";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { type TerminalContextSelection } from "~/lib/terminalContext";
import { openInPreferredEditor } from "../editorPreferences";
import {
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
} from "../terminal-links";
import { isTerminalClearShortcut, terminalNavigationShortcutData } from "../keybindings";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "../types";
import { readNativeApi } from "~/nativeApi";

const MIN_DRAWER_HEIGHT = 180;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH_RATIO = 0.75;
const MULTI_CLICK_SELECTION_ACTION_DELAY_MS = 260;

function maxDrawerHeight(): number {
  if (typeof window === "undefined") return DEFAULT_THREAD_TERMINAL_HEIGHT;
  return Math.max(MIN_DRAWER_HEIGHT, Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_RATIO));
}

function clampDrawerHeight(height: number): number {
  const safeHeight = Number.isFinite(height) ? height : DEFAULT_THREAD_TERMINAL_HEIGHT;
  const maxHeight = maxDrawerHeight();
  return Math.min(Math.max(Math.round(safeHeight), MIN_DRAWER_HEIGHT), maxHeight);
}

function maxPanelWidth(): number {
  if (typeof window === "undefined") return 480;
  return Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO));
}

function clampPanelWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? width : 480;
  const max = maxPanelWidth();
  return Math.min(Math.max(Math.round(safeWidth), MIN_PANEL_WIDTH), max);
}

function writeSystemMessage(terminal: Terminal, message: string): void {
  terminal.write(`\r\n[terminal] ${message}\r\n`);
}

function terminalThemeFromApp(): ITheme {
  const isDark = document.documentElement.classList.contains("dark");
  const bodyStyles = getComputedStyle(document.body);
  const background =
    bodyStyles.backgroundColor || (isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)");
  const foreground = bodyStyles.color || (isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)");

  if (isDark) {
    return {
      background,
      foreground,
      cursor: "rgb(180, 203, 255)",
      selectionBackground: "rgba(180, 203, 255, 0.25)",
      scrollbarSliderBackground: "rgba(255, 255, 255, 0.1)",
      scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.18)",
      scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.22)",
      black: "rgb(24, 30, 38)",
      red: "rgb(255, 122, 142)",
      green: "rgb(134, 231, 149)",
      yellow: "rgb(244, 205, 114)",
      blue: "rgb(137, 190, 255)",
      magenta: "rgb(208, 176, 255)",
      cyan: "rgb(124, 232, 237)",
      white: "rgb(210, 218, 230)",
      brightBlack: "rgb(110, 120, 136)",
      brightRed: "rgb(255, 168, 180)",
      brightGreen: "rgb(176, 245, 186)",
      brightYellow: "rgb(255, 224, 149)",
      brightBlue: "rgb(174, 210, 255)",
      brightMagenta: "rgb(229, 203, 255)",
      brightCyan: "rgb(167, 244, 247)",
      brightWhite: "rgb(244, 247, 252)",
    };
  }

  return {
    background,
    foreground,
    cursor: "rgb(38, 56, 78)",
    selectionBackground: "rgba(37, 63, 99, 0.2)",
    scrollbarSliderBackground: "rgba(0, 0, 0, 0.15)",
    scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.25)",
    scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.3)",
    black: "rgb(44, 53, 66)",
    red: "rgb(191, 70, 87)",
    green: "rgb(60, 126, 86)",
    yellow: "rgb(146, 112, 35)",
    blue: "rgb(72, 102, 163)",
    magenta: "rgb(132, 86, 149)",
    cyan: "rgb(53, 127, 141)",
    white: "rgb(210, 215, 223)",
    brightBlack: "rgb(112, 123, 140)",
    brightRed: "rgb(212, 95, 112)",
    brightGreen: "rgb(85, 148, 111)",
    brightYellow: "rgb(173, 133, 45)",
    brightBlue: "rgb(91, 124, 194)",
    brightMagenta: "rgb(153, 107, 172)",
    brightCyan: "rgb(70, 149, 164)",
    brightWhite: "rgb(236, 240, 246)",
  };
}

function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) {
    return null;
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }

  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null;
}

export function resolveTerminalSelectionActionPosition(options: {
  bounds: { left: number; top: number; width: number; height: number };
  selectionRect: { right: number; bottom: number } | null;
  pointer: { x: number; y: number } | null;
  viewport?: { width: number; height: number } | null;
}): { x: number; y: number } {
  const { bounds, selectionRect, pointer, viewport } = options;
  const viewportWidth =
    viewport?.width ??
    (typeof window === "undefined" ? bounds.left + bounds.width + 8 : window.innerWidth);
  const viewportHeight =
    viewport?.height ??
    (typeof window === "undefined" ? bounds.top + bounds.height + 8 : window.innerHeight);
  const drawerLeft = Math.round(bounds.left);
  const drawerTop = Math.round(bounds.top);
  const drawerRight = Math.round(bounds.left + bounds.width);
  const drawerBottom = Math.round(bounds.top + bounds.height);
  const preferredX =
    selectionRect !== null
      ? Math.round(selectionRect.right)
      : pointer === null
        ? Math.round(bounds.left + bounds.width - 140)
        : Math.max(drawerLeft, Math.min(Math.round(pointer.x), drawerRight));
  const preferredY =
    selectionRect !== null
      ? Math.round(selectionRect.bottom + 4)
      : pointer === null
        ? Math.round(bounds.top + 12)
        : Math.max(drawerTop, Math.min(Math.round(pointer.y), drawerBottom));
  return {
    x: Math.max(8, Math.min(preferredX, Math.max(viewportWidth - 8, 8))),
    y: Math.max(8, Math.min(preferredY, Math.max(viewportHeight - 8, 8))),
  };
}

export function terminalSelectionActionDelayForClickCount(clickCount: number): number {
  return clickCount >= 2 ? MULTI_CLICK_SELECTION_ACTION_DELAY_MS : 0;
}

export function shouldHandleTerminalSelectionMouseUp(
  selectionGestureActive: boolean,
  button: number,
): boolean {
  return selectionGestureActive && button === 0;
}

interface TerminalViewportProps {
  threadId: ThreadId;
  terminalId: string;
  terminalLabel: string;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  startupCommand?: string;
  onSessionExited: () => void;
  onCwdChange?: (terminalId: string, cwd: string) => void;
  onStartupCommandDetected?: (terminalId: string, command: string) => void;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  focusRequestId: number;
  autoFocus: boolean;
  resizeEpoch: number;
  drawerHeight: number;
  panelWidth: number;
}

function TerminalViewport({
  threadId,
  terminalId,
  terminalLabel,
  cwd,
  runtimeEnv,
  startupCommand,
  onSessionExited,
  onCwdChange,
  onStartupCommandDetected,
  onAddTerminalContext,
  focusRequestId,
  autoFocus,
  resizeEpoch,
  drawerHeight,
  panelWidth,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onSessionExitedRef = useRef(onSessionExited);
  const onCwdChangeRef = useRef(onCwdChange);
  const onStartupCommandDetectedRef = useRef(onStartupCommandDetected);
  const startupCommandRef = useRef(startupCommand);
  const onAddTerminalContextRef = useRef(onAddTerminalContext);
  const terminalLabelRef = useRef(terminalLabel);
  const hasHandledExitRef = useRef(false);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionGestureActiveRef = useRef(false);
  const selectionActionRequestIdRef = useRef(0);
  const selectionActionOpenRef = useRef(false);
  const selectionActionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onSessionExitedRef.current = onSessionExited;
  }, [onSessionExited]);

  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  useEffect(() => {
    onStartupCommandDetectedRef.current = onStartupCommandDetected;
  }, [onStartupCommandDetected]);

  useEffect(() => {
    startupCommandRef.current = startupCommand;
  }, [startupCommand]);

  useEffect(() => {
    onAddTerminalContextRef.current = onAddTerminalContext;
  }, [onAddTerminalContext]);

  useEffect(() => {
    terminalLabelRef.current = terminalLabel;
  }, [terminalLabel]);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    let disposed = false;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      lineHeight: 1.15,
      fontSize: 13,
      scrollback: 5_000,
      fontFamily:
        '"JetBrains Mono Nerd", "JetBrainsMono Nerd Font", "JetBrains Mono", "FiraCode Nerd Font", "Hack Nerd Font", "CaskaydiaCove Nerd Font", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      theme: {
        ...terminalThemeFromApp(),
      },
    });
    terminal.loadAddon(fitAddon);
    terminal.open(mount);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const api = readNativeApi();
    if (!api) return;

    const clearSelectionAction = () => {
      selectionActionRequestIdRef.current += 1;
      if (selectionActionTimerRef.current !== null) {
        window.clearTimeout(selectionActionTimerRef.current);
        selectionActionTimerRef.current = null;
      }
    };

    const readSelectionAction = (): {
      position: { x: number; y: number };
      selection: TerminalContextSelection;
    } | null => {
      const activeTerminal = terminalRef.current;
      const mountElement = containerRef.current;
      if (!activeTerminal || !mountElement || !activeTerminal.hasSelection()) {
        return null;
      }
      const selectionText = activeTerminal.getSelection();
      const selectionPosition = activeTerminal.getSelectionPosition();
      const normalizedText = selectionText.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
      if (!selectionPosition || normalizedText.length === 0) {
        return null;
      }
      const lineStart = selectionPosition.start.y + 1;
      const lineCount = normalizedText.split("\n").length;
      const lineEnd = Math.max(lineStart, lineStart + lineCount - 1);
      const bounds = mountElement.getBoundingClientRect();
      const selectionRect = getTerminalSelectionRect(mountElement);
      const position = resolveTerminalSelectionActionPosition({
        bounds,
        selectionRect:
          selectionRect === null
            ? null
            : { right: selectionRect.right, bottom: selectionRect.bottom },
        pointer: selectionPointerRef.current,
      });
      return {
        position,
        selection: {
          terminalId,
          terminalLabel: terminalLabelRef.current,
          lineStart,
          lineEnd,
          text: normalizedText,
        },
      };
    };

    const showSelectionAction = async () => {
      if (selectionActionOpenRef.current) {
        return;
      }
      const nextAction = readSelectionAction();
      if (!nextAction) {
        clearSelectionAction();
        return;
      }
      const requestId = ++selectionActionRequestIdRef.current;
      selectionActionOpenRef.current = true;
      try {
        const clicked = await api.contextMenu.show(
          [{ id: "add-to-chat", label: "Add to chat" }],
          nextAction.position,
        );
        if (requestId !== selectionActionRequestIdRef.current || clicked !== "add-to-chat") {
          return;
        }
        onAddTerminalContextRef.current(nextAction.selection);
        terminalRef.current?.clearSelection();
        terminalRef.current?.focus();
      } finally {
        selectionActionOpenRef.current = false;
      }
    };

    const sendTerminalInput = async (data: string, fallbackError: string) => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      try {
        await api.terminal.write({ threadId, terminalId, data });
      } catch (error) {
        writeSystemMessage(activeTerminal, error instanceof Error ? error.message : fallbackError);
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      // Let Alt+key combos used for terminal shortcuts (toggle, split, new, close)
      // bubble up to the global keydown handler instead of being sent to the PTY
      // as ESC sequences. The global handler in ChatView dispatches the commands.
      if (
        event.type === "keydown" &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "j" || event.key === "d" || event.key === "n" || event.key === "w")
      ) {
        return false;
      }

      const navigationData = terminalNavigationShortcutData(event);
      if (navigationData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void sendTerminalInput(navigationData, "Failed to move cursor");
        return false;
      }

      if (!isTerminalClearShortcut(event)) return true;
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput("\u000c", "Failed to clear terminal");
      return false;
    });

    const terminalLinksDisposable = terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) {
          callback(undefined);
          return;
        }

        const line = activeTerminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }

        const lineText = line.translateToString(true);
        const matches = extractTerminalLinks(lineText);
        if (matches.length === 0) {
          callback(undefined);
          return;
        }

        callback(
          matches.map((match) => ({
            text: match.text,
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: match.end, y: bufferLineNumber },
            },
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) return;

              const latestTerminal = terminalRef.current;
              if (!latestTerminal) return;

              if (match.kind === "url") {
                void api.shell.openExternal(match.text).catch((error) => {
                  writeSystemMessage(
                    latestTerminal,
                    error instanceof Error ? error.message : "Unable to open link",
                  );
                });
                return;
              }

              const target = resolvePathLinkTarget(match.text, cwd);
              void openInPreferredEditor(api, target).catch((error) => {
                writeSystemMessage(
                  latestTerminal,
                  error instanceof Error ? error.message : "Unable to open path",
                );
              });
            },
          })),
        );
      },
    });

    const inputDisposable = terminal.onData((data) => {
      void api.terminal
        .write({ threadId, terminalId, data })
        .catch((err) =>
          writeSystemMessage(
            terminal,
            err instanceof Error ? err.message : "Terminal write failed",
          ),
        );
    });

    const selectionDisposable = terminal.onSelectionChange(() => {
      if (terminalRef.current?.hasSelection()) {
        return;
      }
      clearSelectionAction();
    });

    const handleMouseUp = (event: MouseEvent) => {
      const shouldHandle = shouldHandleTerminalSelectionMouseUp(
        selectionGestureActiveRef.current,
        event.button,
      );
      selectionGestureActiveRef.current = false;
      if (!shouldHandle) {
        return;
      }
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
      const delay = terminalSelectionActionDelayForClickCount(event.detail);
      selectionActionTimerRef.current = window.setTimeout(() => {
        selectionActionTimerRef.current = null;
        window.requestAnimationFrame(() => {
          void showSelectionAction();
        });
      }, delay);
    };
    const handlePointerDown = (event: PointerEvent) => {
      clearSelectionAction();
      selectionGestureActiveRef.current = event.button === 0;
    };
    window.addEventListener("mouseup", handleMouseUp);
    mount.addEventListener("pointerdown", handlePointerDown);

    const themeObserver = new MutationObserver(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      activeTerminal.options.theme = terminalThemeFromApp();
      activeTerminal.refresh(0, activeTerminal.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const openTerminal = async () => {
      try {
        const activeTerminal = terminalRef.current;
        const activeFitAddon = fitAddonRef.current;
        if (!activeTerminal || !activeFitAddon) return;
        activeFitAddon.fit();
        const snapshot = await api.terminal.open({
          threadId,
          terminalId,
          cwd,
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
          ...(runtimeEnv ? { env: runtimeEnv } : {}),
        });
        if (disposed) return;
        // Track the CWD from the server snapshot
        if (snapshot.cwd) {
          onCwdChangeRef.current?.(terminalId, snapshot.cwd);
        }
        activeTerminal.write("\u001bc");
        if (snapshot.history.length > 0) {
          activeTerminal.write(snapshot.history);
        }
        if (autoFocus) {
          window.requestAnimationFrame(() => {
            activeTerminal.focus();
          });
        }
        // Auto-run startup command on fresh terminal (post-restart, no existing history)
        if (snapshot.history.length === 0 && startupCommandRef.current) {
          window.setTimeout(() => {
            if (disposed) return;
            void api.terminal
              .write({ threadId, terminalId, data: startupCommandRef.current + "\r" })
              .catch(() => undefined);
          }, 300);
        }
      } catch (err) {
        if (disposed) return;
        writeSystemMessage(
          terminal,
          err instanceof Error ? err.message : "Failed to open terminal",
        );
      }
    };

    const unsubscribe = api?.terminal.onEvent((event) => {
      if (disposed) return;
      if (event.threadId !== threadId || event.terminalId !== terminalId) return;
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;

      if (event.type === "cwdChanged") {
        onCwdChangeRef.current?.(terminalId, event.cwd);
        return;
      }

      if (event.type === "sessionDetected") {
        onStartupCommandDetectedRef.current?.(terminalId, `claude --resume ${event.sessionName}`);
        return;
      }

      if (event.type === "output") {
        activeTerminal.write(event.data);
        clearSelectionAction();
        return;
      }

      if (event.type === "started" || event.type === "restarted") {
        hasHandledExitRef.current = false;
        clearSelectionAction();
        if (event.snapshot.cwd) {
          onCwdChangeRef.current?.(terminalId, event.snapshot.cwd);
        }
        activeTerminal.write("\u001bc");
        if (event.snapshot.history.length > 0) {
          activeTerminal.write(event.snapshot.history);
        }
        return;
      }

      if (event.type === "cleared") {
        clearSelectionAction();
        activeTerminal.clear();
        activeTerminal.write("\u001bc");
        return;
      }

      if (event.type === "error") {
        writeSystemMessage(activeTerminal, event.message);
        return;
      }

      if (event.type === "exited") {
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        writeSystemMessage(
          activeTerminal,
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        );
        if (hasHandledExitRef.current) {
          return;
        }
        hasHandledExitRef.current = true;
        window.setTimeout(() => {
          if (!hasHandledExitRef.current) {
            return;
          }
          onSessionExitedRef.current();
        }, 0);
      }
    });

    const fitTimer = window.setTimeout(() => {
      if (disposed) return;
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) return;
      const wasAtBottom =
        activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY;
      activeFitAddon.fit();
      if (wasAtBottom) {
        activeTerminal.scrollToBottom();
      }
      void api.terminal
        .resize({
          threadId,
          terminalId,
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
        })
        .catch(() => undefined);
    }, 30);
    void openTerminal();

    return () => {
      disposed = true;
      window.clearTimeout(fitTimer);
      unsubscribe();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      terminalLinksDisposable.dispose();
      if (selectionActionTimerRef.current !== null) {
        window.clearTimeout(selectionActionTimerRef.current);
      }
      window.removeEventListener("mouseup", handleMouseUp);
      mount.removeEventListener("pointerdown", handlePointerDown);
      themeObserver.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
    // autoFocus is intentionally omitted;
    // it is only read at mount time and must not trigger terminal teardown/recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, runtimeEnv, terminalId, threadId]);

  useEffect(() => {
    if (!autoFocus) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const frame = window.requestAnimationFrame(() => {
      terminal.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [autoFocus, focusRequestId]);

  useEffect(() => {
    const api = readNativeApi();
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!api || !terminal || !fitAddon) return;
    const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
    const frame = window.requestAnimationFrame(() => {
      fitAddon.fit();
      if (wasAtBottom) {
        terminal.scrollToBottom();
      }
      void api.terminal
        .resize({
          threadId,
          terminalId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .catch(() => undefined);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [drawerHeight, panelWidth, resizeEpoch, terminalId, threadId]);
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-[4px]" />
  );
}

interface ThreadTerminalDrawerProps {
  threadId: ThreadId;
  cwd: string;
  cwdByTerminalId?: Record<string, string>;
  startupCommandByTerminalId?: Record<string, string>;
  runtimeEnv?: Record<string, string>;
  height: number;
  width?: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
  focusRequestId: number;
  onSplitTerminal: () => void;
  onNewTerminal: () => void;
  splitShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onHeightChange: (height: number) => void;
  onWidthChange?: (width: number) => void;
  onCwdChange?: (terminalId: string, cwd: string) => void;
  onStartupCommandDetected?: (terminalId: string, command: string) => void;
  onStartupCommandChange?: (terminalId: string, command: string) => void;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

interface TerminalActionButtonProps {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}

function TerminalActionButton({ label, className, onClick, children }: TerminalActionButtonProps) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<button type="button" className={className} onClick={onClick} aria-label={label} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="bottom"
        sideOffset={6}
        align="center"
        className="pointer-events-none select-none"
      >
        {label}
      </PopoverPopup>
    </Popover>
  );
}

function TerminalStartupCommandEditor({
  terminalId,
  value,
  onChange,
}: {
  terminalId: string;
  value: string;
  onChange: (terminalId: string, command: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onChange(terminalId, trimmed);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="p-0.5 text-foreground/80 transition-colors hover:bg-accent"
            aria-label="Startup command settings"
            onClick={() => setOpen((v) => !v)}
          />
        }
      >
        <Settings className="size-3" />
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        sideOffset={6}
        align="end"
        className="z-50 rounded-md border border-border bg-popover p-2 shadow-md"
      >
        <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
          Startup command
        </label>
        <input
          ref={inputRef}
          type="text"
          className="w-56 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary"
          placeholder="e.g. claude --resume my-session"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          onBlur={commit}
        />
        {value && (
          <div className="mt-1 truncate text-[9px] text-muted-foreground/70" title={value}>
            Current: {value}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

export default function ThreadTerminalDrawer({
  threadId,
  cwd,
  cwdByTerminalId,
  startupCommandByTerminalId,
  runtimeEnv,
  height,
  width = 480,
  terminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  focusRequestId,
  onSplitTerminal,
  onNewTerminal,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  onActiveTerminalChange,
  onCloseTerminal,
  onHeightChange,
  onWidthChange,
  onCwdChange,
  onStartupCommandDetected,
  onStartupCommandChange,
  onAddTerminalContext,
}: ThreadTerminalDrawerProps) {
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(width));
  const [drawerHeight, setDrawerHeight] = useState(() => clampDrawerHeight(height));
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const panelWidthRef = useRef(panelWidth);
  const lastSyncedWidthRef = useRef(clampPanelWidth(width));
  const drawerHeightRef = useRef(drawerHeight);
  const lastSyncedHeightRef = useRef(clampDrawerHeight(height));
  const onHeightChangeRef = useRef(onHeightChange);
  const onWidthChangeRef = useRef(onWidthChange);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  const normalizedTerminalIds = useMemo(() => {
    const cleaned = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    return cleaned.length > 0 ? cleaned : [DEFAULT_THREAD_TERMINAL_ID];
  }, [terminalIds]);

  const resolvedActiveTerminalId = normalizedTerminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : (normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);

  const resolvedTerminalGroups = useMemo(() => {
    const validTerminalIdSet = new Set(normalizedTerminalIds);
    const assignedTerminalIds = new Set<string>();
    const usedGroupIds = new Set<string>();
    const nextGroups: ThreadTerminalGroup[] = [];

    const assignUniqueGroupId = (groupId: string): string => {
      if (!usedGroupIds.has(groupId)) {
        usedGroupIds.add(groupId);
        return groupId;
      }
      let suffix = 2;
      while (usedGroupIds.has(`${groupId}-${suffix}`)) {
        suffix += 1;
      }
      const uniqueGroupId = `${groupId}-${suffix}`;
      usedGroupIds.add(uniqueGroupId);
      return uniqueGroupId;
    };

    for (const terminalGroup of terminalGroups) {
      const nextTerminalIds = [
        ...new Set(terminalGroup.terminalIds.map((id) => id.trim()).filter((id) => id.length > 0)),
      ].filter((terminalId) => {
        if (!validTerminalIdSet.has(terminalId)) return false;
        if (assignedTerminalIds.has(terminalId)) return false;
        return true;
      });
      if (nextTerminalIds.length === 0) continue;

      for (const terminalId of nextTerminalIds) {
        assignedTerminalIds.add(terminalId);
      }

      const baseGroupId =
        terminalGroup.id.trim().length > 0
          ? terminalGroup.id.trim()
          : `group-${nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID}`;
      nextGroups.push({
        id: assignUniqueGroupId(baseGroupId),
        terminalIds: nextTerminalIds,
      });
    }

    for (const terminalId of normalizedTerminalIds) {
      if (assignedTerminalIds.has(terminalId)) continue;
      nextGroups.push({
        id: assignUniqueGroupId(`group-${terminalId}`),
        terminalIds: [terminalId],
      });
    }

    if (nextGroups.length > 0) {
      return nextGroups;
    }

    return [
      {
        id: `group-${resolvedActiveTerminalId}`,
        terminalIds: [resolvedActiveTerminalId],
      },
    ];
  }, [normalizedTerminalIds, resolvedActiveTerminalId, terminalGroups]);

  const resolvedActiveGroupIndex = useMemo(() => {
    const indexById = resolvedTerminalGroups.findIndex(
      (terminalGroup) => terminalGroup.id === activeTerminalGroupId,
    );
    if (indexById >= 0) return indexById;
    const indexByTerminal = resolvedTerminalGroups.findIndex((terminalGroup) =>
      terminalGroup.terminalIds.includes(resolvedActiveTerminalId),
    );
    return indexByTerminal >= 0 ? indexByTerminal : 0;
  }, [activeTerminalGroupId, resolvedActiveTerminalId, resolvedTerminalGroups]);

  const visibleTerminalIds = resolvedTerminalGroups[resolvedActiveGroupIndex]?.terminalIds ?? [
    resolvedActiveTerminalId,
  ];
  const hasTerminalSidebar = normalizedTerminalIds.length > 1;
  const isSplitView = visibleTerminalIds.length > 1;
  const showGroupHeaders =
    resolvedTerminalGroups.length > 1 ||
    resolvedTerminalGroups.some((terminalGroup) => terminalGroup.terminalIds.length > 1);
  const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;
  const terminalLabelById = useMemo(
    () =>
      new Map(
        normalizedTerminalIds.map((terminalId, index) => [terminalId, `Terminal ${index + 1}`]),
      ),
    [normalizedTerminalIds],
  );
  const splitTerminalActionLabel = hasReachedSplitLimit
    ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : splitShortcutLabel
      ? `Split Terminal (${splitShortcutLabel})`
      : "Split Terminal";
  const newTerminalActionLabel = newShortcutLabel
    ? `New Terminal (${newShortcutLabel})`
    : "New Terminal";
  const closeTerminalActionLabel = closeShortcutLabel
    ? `Close Terminal (${closeShortcutLabel})`
    : "Close Terminal";
  const onSplitTerminalAction = useCallback(() => {
    if (hasReachedSplitLimit) return;
    onSplitTerminal();
  }, [hasReachedSplitLimit, onSplitTerminal]);
  const onNewTerminalAction = useCallback(() => {
    onNewTerminal();
  }, [onNewTerminal]);

  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  useEffect(() => {
    drawerHeightRef.current = drawerHeight;
  }, [drawerHeight]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  const syncWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampPanelWidth(nextWidth);
    if (lastSyncedWidthRef.current === clampedWidth) return;
    lastSyncedWidthRef.current = clampedWidth;
    onWidthChangeRef.current?.(clampedWidth);
  }, []);

  const _syncHeight = useCallback((nextHeight: number) => {
    const clampedHeight = clampDrawerHeight(nextHeight);
    if (lastSyncedHeightRef.current === clampedHeight) return;
    lastSyncedHeightRef.current = clampedHeight;
    onHeightChangeRef.current(clampedHeight);
  }, []);

  useEffect(() => {
    const clampedWidth = clampPanelWidth(width);
    setPanelWidth(clampedWidth);
    panelWidthRef.current = clampedWidth;
    lastSyncedWidthRef.current = clampedWidth;
  }, [width, threadId]);

  useEffect(() => {
    const clampedHeight = clampDrawerHeight(height);
    setDrawerHeight(clampedHeight);
    drawerHeightRef.current = clampedHeight;
    lastSyncedHeightRef.current = clampedHeight;
  }, [height, threadId]);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    didResizeDuringDragRef.current = false;
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidthRef.current,
    };
  }, []);

  const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const clampedWidth = clampPanelWidth(
      resizeState.startWidth + (resizeState.startX - event.clientX),
    );
    if (clampedWidth === panelWidthRef.current) {
      return;
    }
    didResizeDuringDragRef.current = true;
    panelWidthRef.current = clampedWidth;
    setPanelWidth(clampedWidth);
  }, []);

  const handleResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!didResizeDuringDragRef.current) {
        return;
      }
      syncWidth(panelWidthRef.current);
      setResizeEpoch((value) => value + 1);
    },
    [syncWidth],
  );

  useEffect(() => {
    const onWindowResize = () => {
      const clampedWidth = clampPanelWidth(panelWidthRef.current);
      const changed = clampedWidth !== panelWidthRef.current;
      if (changed) {
        setPanelWidth(clampedWidth);
        panelWidthRef.current = clampedWidth;
      }
      if (!resizeStateRef.current) {
        syncWidth(clampedWidth);
      }
      setResizeEpoch((value) => value + 1);
    };
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [syncWidth]);

  useEffect(() => {
    return () => {
      syncWidth(panelWidthRef.current);
    };
  }, [syncWidth]);

  const [panelTab, setPanelTab] = useState<"terminal" | "context">("terminal");

  return (
    <aside
      className="thread-terminal-drawer relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/80 bg-background"
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      />

      {/* Panel tab bar */}
      <div className="flex shrink-0 items-stretch border-b border-border/60">
        <button
          type="button"
          className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${
            panelTab === "terminal"
              ? "border-b border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setPanelTab("terminal")}
        >
          <TerminalSquare className="size-2.5" />
          Terminal
        </button>
        <button
          type="button"
          className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${
            panelTab === "context"
              ? "border-b border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setPanelTab("context")}
        >
          <FileText className="size-2.5" />
          Context
        </button>
      </div>

      {panelTab === "context" ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/60">
          Context viewer coming soon
        </div>
      ) : (
        <>
          {!hasTerminalSidebar && (
            <div className="pointer-events-none absolute right-1 top-0.5 z-20">
              <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded border border-border/60 bg-background/80 backdrop-blur-sm">
                <TerminalActionButton
                  className={`p-0.5 text-foreground/80 transition-colors ${
                    hasReachedSplitLimit
                      ? "cursor-not-allowed opacity-45 hover:bg-transparent"
                      : "hover:bg-accent"
                  }`}
                  onClick={onSplitTerminalAction}
                  label={splitTerminalActionLabel}
                >
                  <SquareSplitHorizontal className="size-3" />
                </TerminalActionButton>
                <div className="h-3 w-px bg-border/60" />
                <TerminalActionButton
                  className="p-0.5 text-foreground/80 transition-colors hover:bg-accent"
                  onClick={onNewTerminalAction}
                  label={newTerminalActionLabel}
                >
                  <Plus className="size-3" />
                </TerminalActionButton>
                <div className="h-3 w-px bg-border/60" />
                <TerminalActionButton
                  className="p-0.5 text-foreground/80 transition-colors hover:bg-accent"
                  onClick={() => onCloseTerminal(resolvedActiveTerminalId)}
                  label={closeTerminalActionLabel}
                >
                  <Trash2 className="size-3" />
                </TerminalActionButton>
                {onStartupCommandChange && (
                  <>
                    <div className="h-3 w-px bg-border/60" />
                    <TerminalStartupCommandEditor
                      terminalId={resolvedActiveTerminalId}
                      value={startupCommandByTerminalId?.[resolvedActiveTerminalId] ?? ""}
                      onChange={onStartupCommandChange}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 w-full flex-1">
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                {isSplitView ? (
                  <div
                    className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
                    style={{
                      gridTemplateColumns: `repeat(${visibleTerminalIds.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {visibleTerminalIds.map((terminalId, idx) => (
                      <div
                        key={terminalId}
                        className={`min-h-0 min-w-0 ${idx > 0 ? "border-l border-border/50" : ""}`}
                        onMouseDown={() => {
                          if (terminalId !== resolvedActiveTerminalId) {
                            onActiveTerminalChange(terminalId);
                          }
                        }}
                      >
                        <div className="h-full px-0.5 pt-0 pb-0">
                          <TerminalViewport
                            threadId={threadId}
                            terminalId={terminalId}
                            terminalLabel={terminalLabelById.get(terminalId) ?? "Terminal"}
                            cwd={cwdByTerminalId?.[terminalId] || cwd}
                            {...(runtimeEnv ? { runtimeEnv } : {})}
                            {...(startupCommandByTerminalId?.[terminalId]
                              ? { startupCommand: startupCommandByTerminalId[terminalId] }
                              : {})}
                            onSessionExited={() => onCloseTerminal(terminalId)}
                            {...(onCwdChange ? { onCwdChange } : {})}
                            {...(onStartupCommandDetected ? { onStartupCommandDetected } : {})}
                            onAddTerminalContext={onAddTerminalContext}
                            focusRequestId={focusRequestId}
                            autoFocus={terminalId === resolvedActiveTerminalId}
                            resizeEpoch={resizeEpoch}
                            drawerHeight={drawerHeight}
                            panelWidth={panelWidth}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full px-0.5 pt-0 pb-0">
                    <TerminalViewport
                      key={resolvedActiveTerminalId}
                      threadId={threadId}
                      terminalId={resolvedActiveTerminalId}
                      terminalLabel={terminalLabelById.get(resolvedActiveTerminalId) ?? "Terminal"}
                      cwd={cwdByTerminalId?.[resolvedActiveTerminalId] || cwd}
                      {...(runtimeEnv ? { runtimeEnv } : {})}
                      {...(startupCommandByTerminalId?.[resolvedActiveTerminalId]
                        ? { startupCommand: startupCommandByTerminalId[resolvedActiveTerminalId] }
                        : {})}
                      onSessionExited={() => onCloseTerminal(resolvedActiveTerminalId)}
                      {...(onCwdChange ? { onCwdChange } : {})}
                      {...(onStartupCommandDetected ? { onStartupCommandDetected } : {})}
                      onAddTerminalContext={onAddTerminalContext}
                      focusRequestId={focusRequestId}
                      autoFocus
                      resizeEpoch={resizeEpoch}
                      drawerHeight={drawerHeight}
                      panelWidth={panelWidth}
                    />
                  </div>
                )}
              </div>

              {hasTerminalSidebar && (
                <aside className="flex w-24 min-w-24 flex-col border-l border-border/50 bg-muted/5">
                  <div className="flex h-[20px] items-stretch justify-end border-b border-border/50">
                    <div className="inline-flex h-full items-stretch">
                      <TerminalActionButton
                        className={`inline-flex h-full items-center px-0.5 text-foreground/80 transition-colors ${
                          hasReachedSplitLimit
                            ? "cursor-not-allowed opacity-45 hover:bg-transparent"
                            : "hover:bg-accent/70"
                        }`}
                        onClick={onSplitTerminalAction}
                        label={splitTerminalActionLabel}
                      >
                        <SquareSplitHorizontal className="size-3" />
                      </TerminalActionButton>
                      <TerminalActionButton
                        className="inline-flex h-full items-center border-l border-border/50 px-0.5 text-foreground/80 transition-colors hover:bg-accent/70"
                        onClick={onNewTerminalAction}
                        label={newTerminalActionLabel}
                      >
                        <Plus className="size-3" />
                      </TerminalActionButton>
                      <TerminalActionButton
                        className="inline-flex h-full items-center border-l border-border/50 px-0.5 text-foreground/80 transition-colors hover:bg-accent/70"
                        onClick={() => onCloseTerminal(resolvedActiveTerminalId)}
                        label={closeTerminalActionLabel}
                      >
                        <Trash2 className="size-3" />
                      </TerminalActionButton>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-0.5 py-0.5">
                    {resolvedTerminalGroups.map((terminalGroup, groupIndex) => {
                      const isGroupActive =
                        terminalGroup.terminalIds.includes(resolvedActiveTerminalId);
                      const groupActiveTerminalId = isGroupActive
                        ? resolvedActiveTerminalId
                        : (terminalGroup.terminalIds[0] ?? resolvedActiveTerminalId);

                      return (
                        <div key={terminalGroup.id} className="pb-px">
                          {showGroupHeaders && (
                            <button
                              type="button"
                              className={`flex w-full items-center rounded px-1 py-px text-[9px] uppercase tracking-[0.08em] ${
                                isGroupActive
                                  ? "bg-accent/70 text-foreground"
                                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                              }`}
                              onClick={() => onActiveTerminalChange(groupActiveTerminalId)}
                            >
                              {terminalGroup.terminalIds.length > 1
                                ? `Split ${groupIndex + 1}`
                                : `Term ${groupIndex + 1}`}
                            </button>
                          )}

                          <div
                            className={
                              showGroupHeaders ? "ml-0.5 border-l border-border/40 pl-1" : ""
                            }
                          >
                            {terminalGroup.terminalIds.map((terminalId) => {
                              const isActive = terminalId === resolvedActiveTerminalId;
                              const startupCmd = startupCommandByTerminalId?.[terminalId];
                              const startupLabel = startupCmd
                                ? startupCmd.replace(/^claude\s+--resume\s+/, "⟳ ")
                                : null;
                              const closeTerminalLabel = `Close ${
                                terminalLabelById.get(terminalId) ?? "terminal"
                              }${isActive && closeShortcutLabel ? ` (${closeShortcutLabel})` : ""}`;
                              return (
                                <div
                                  key={terminalId}
                                  className={`group flex flex-col rounded px-0.5 py-px text-[10px] ${
                                    isActive
                                      ? "bg-accent text-foreground"
                                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                  }`}
                                >
                                  <div className="flex items-center gap-0.5">
                                    {showGroupHeaders && (
                                      <span className="text-[9px] text-muted-foreground/70">└</span>
                                    )}
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-center gap-0.5 text-left"
                                      onClick={() => onActiveTerminalChange(terminalId)}
                                    >
                                      <TerminalSquare className="size-2.5 shrink-0" />
                                      <span className="truncate">
                                        {terminalLabelById.get(terminalId) ?? "Term"}
                                      </span>
                                    </button>
                                    {normalizedTerminalIds.length > 1 && (
                                      <Popover>
                                        <PopoverTrigger
                                          openOnHover
                                          render={
                                            <button
                                              type="button"
                                              className="inline-flex size-3 items-center justify-center rounded text-xs font-medium leading-none text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                                              onClick={() => onCloseTerminal(terminalId)}
                                              aria-label={closeTerminalLabel}
                                            />
                                          }
                                        >
                                          <XIcon className="size-2" />
                                        </PopoverTrigger>
                                        <PopoverPopup
                                          tooltipStyle
                                          side="bottom"
                                          sideOffset={6}
                                          align="center"
                                          className="pointer-events-none select-none"
                                        >
                                          {closeTerminalLabel}
                                        </PopoverPopup>
                                      </Popover>
                                    )}
                                  </div>
                                  {startupLabel && (
                                    <span
                                      className="ml-3.5 truncate text-[8px] leading-tight text-muted-foreground/70"
                                      title={startupCmd}
                                    >
                                      {startupLabel}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </aside>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
