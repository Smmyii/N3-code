"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import * as React from "react";

import { cn } from "~/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn("flex gap-1 border-b border-border", className)} {...props} />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors",
        "hover:text-foreground",
        "data-[selected]:text-foreground",
        "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:transition-colors",
        "data-[selected]:after:bg-primary",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded-sm",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return <TabsPrimitive.Panel className={cn("pt-4", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
