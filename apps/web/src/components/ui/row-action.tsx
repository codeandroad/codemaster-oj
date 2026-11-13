"use client";

import { forwardRef } from "react";
import { Button, buttonVariants, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

// Shared by buttons and navigation links in list/table action groups.
export const rowActionClassName = cn(buttonVariants({ variant: "secondary", size: "sm", className: "whitespace-nowrap" }));

export const RowActionButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "variant" | "size">>(
  ({ className, type = "button", ...props }, ref) => (
    <Button {...props} ref={ref} type={type} variant="secondary" size="sm" className={cn("whitespace-nowrap", className)} />
  ),
);
RowActionButton.displayName = "RowActionButton";
