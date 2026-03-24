import { type ProjectEntry, type ModelSlug, type ProviderKind } from "@t3tools/contracts";
import { memo, useMemo } from "react";
import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import type { ComposerMenuLayout } from "~/appSettings";
import { BotIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandGroup, CommandGroupLabel, CommandItem, CommandList } from "../ui/command";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

export type ComposerMenuSection = "skills" | "subagents" | "files";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
      section?: ComposerMenuSection;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill" | "subagent";
      provider: ProviderKind;
      slug: string;
      label: string;
      description: string;
      section?: ComposerMenuSection;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: ModelSlug;
      label: string;
      description: string;
    };

const SECTION_ORDER: readonly ComposerMenuSection[] = ["skills", "subagents", "files"];
const SECTION_LABELS: Record<ComposerMenuSection, string> = {
  skills: "Skills",
  subagents: "Subagents",
  files: "Files",
};

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  activeProvider: ProviderKind;
  menuLayout: ComposerMenuLayout;
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  query: string;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onBrowseSkills: (query: string) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const providerItemCount = props.items.filter(
    (item): item is Extract<ComposerCommandItem, { provider: ProviderKind }> => "provider" in item,
  );
  const showProviderBadge =
    new Set(providerItemCount.map((item) => item.provider)).size > 1 ||
    (providerItemCount.length > 0 && props.items.some((item) => item.type === "path"));

  const hasSections = props.items.some((item) => "section" in item && item.section != null);
  const useSections = props.menuLayout === "separated" && hasSections;

  const sections = useMemo(() => {
    if (!useSections) return null;
    return SECTION_ORDER.map((key) => ({
      key,
      label: SECTION_LABELS[key],
      items: props.items.filter((item) => "section" in item && item.section === key),
    })).filter((s) => s.items.length > 0);
  }, [useSections, props.items]);

  return (
    <Command
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs">
        <CommandList className="max-h-[min(16rem,50vh)]">
          {sections
            ? sections.map((section) => (
                <CommandGroup key={section.key}>
                  <CommandGroupLabel className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.label}
                  </CommandGroupLabel>
                  {section.items.map((item) => (
                    <ComposerCommandMenuItem
                      key={item.id}
                      item={item}
                      showProviderBadge={showProviderBadge}
                      resolvedTheme={props.resolvedTheme}
                      isActive={props.activeItemId === item.id}
                      onSelect={props.onSelect}
                    />
                  ))}
                </CommandGroup>
              ))
            : props.items.map((item) => (
                <ComposerCommandMenuItem
                  key={item.id}
                  item={item}
                  showProviderBadge={showProviderBadge}
                  resolvedTheme={props.resolvedTheme}
                  isActive={props.activeItemId === item.id}
                  onSelect={props.onSelect}
                />
              ))}
        </CommandList>
        {props.items.length === 0 && (
          <div className="px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              {props.isLoading
                ? "Searching workspace files..."
                : props.triggerKind === "path"
                  ? props.activeProvider === "claudeAgent"
                    ? "No matching Claude subagents or files."
                    : "No matching files or folders."
                  : props.triggerKind === "skill" || props.triggerKind === "subagent"
                    ? props.activeProvider === "claudeAgent"
                      ? "No matching Claude skills."
                      : "No matching Codex skills."
                    : "No matching command."}
            </p>
            {!props.isLoading && props.triggerKind === "skill" ? (
              <button
                type="button"
                className="mt-2 text-[11px] font-medium text-foreground underline underline-offset-2"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  props.onBrowseSkills(props.query);
                }}
              >
                Browse skills.sh
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  showProviderBadge: boolean;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      className={cn(
        "cursor-pointer select-none gap-2",
        props.isActive && "bg-accent text-accent-foreground",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "skill" ? (
        <SparklesIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "subagent" ? (
        <UsersIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
          model
        </Badge>
      ) : null}
      {props.item.type === "skill" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
          skill
        </Badge>
      ) : null}
      {props.item.type === "subagent" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
          subagent
        </Badge>
      ) : null}
      {props.showProviderBadge &&
      (props.item.type === "skill" ||
        props.item.type === "subagent" ||
        props.item.type === "model") ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
          {props.item.provider === "claudeAgent" ? "Claude" : "Codex"}
        </Badge>
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{props.item.label}</span>
      </span>
      <span className="truncate text-muted-foreground text-xs">{props.item.description}</span>
    </CommandItem>
  );
});
