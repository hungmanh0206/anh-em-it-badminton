"use client";

import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SelectOption = string | { value: string; label: string };
type GlassSelectProps = { value: string; options: SelectOption[]; onChange: (value: string) => void; ariaLabel?: string; className?: string; disabled?: boolean };

const GAP = 6;
const MAX_LIST_HEIGHT = 300;
const toOption = (option: SelectOption) => (typeof option === "string" ? { value: option, label: option } : option);

// The app's dropdown: browsers do not let a native <select> list be styled. The list is portalled to
// <body> so panels with overflow hidden and modals cannot clip it.
export function GlassSelect({ value, options, onChange, ariaLabel, className = "", disabled = false }: GlassSelectProps) {
  const items = options.map(toOption);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const openList = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    const below = window.innerHeight - rect.bottom - GAP * 2;
    const above = rect.top - GAP * 2;
    const dropUp = below < Math.min(MAX_LIST_HEIGHT, items.length * 40 + 12) && above > below;
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: Math.min(MAX_LIST_HEIGHT, dropUp ? above : below),
      ...(dropUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
    setActiveIndex(Math.max(selectedIndex, 0));
    setOpen(true);
  };
  const closeList = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (next: string) => {
    if (next !== value) onChange(next);
    closeList();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const closeOnPageMove = (event: Event) => {
      if (!(event.target instanceof Node && listRef.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("scroll", closeOnPageMove, true);
    window.addEventListener("resize", closeOnPageMove);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("scroll", closeOnPageMove, true);
      window.removeEventListener("resize", closeOnPageMove);
    };
  }, [open]);

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") closeList();
    else if (event.key === "Tab") setOpen(false);
    else if (event.key === "ArrowDown") setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    else if (event.key === "ArrowUp") setActiveIndex((index) => Math.max(index - 1, 0));
    else if (event.key === "Home") setActiveIndex(0);
    else if (event.key === "End") setActiveIndex(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") { if (items[activeIndex]) choose(items[activeIndex].value); }
    else return;
    if (event.key !== "Tab") event.preventDefault();
  };
  useEffect(() => {
    if (open) listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`glass-select ${className}`.trim()}
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled}
      onClick={() => (open ? setOpen(false) : openList())}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openList(); } }}
    >
      <span>{items[selectedIndex]?.label ?? value}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    {open && createPortal(<ul ref={listRef} id={listId} className="glass-select-list" role="listbox" aria-label={ariaLabel} aria-activedescendant={`${listId}-${activeIndex}`} tabIndex={-1} style={position} onKeyDown={onListKey}>
      {items.map((item, index) => <li key={item.value} id={`${listId}-${index}`} role="option" aria-selected={item.value === value} className={index === activeIndex ? "is-active" : undefined} onPointerEnter={() => setActiveIndex(index)} onClick={() => choose(item.value)}>{item.label}</li>)}
    </ul>, document.body)}
  </>;
}
