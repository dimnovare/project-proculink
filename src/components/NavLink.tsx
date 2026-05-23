"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  className?: string;
  activeClassName?: string;
  children?: React.ReactNode;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ className, activeClassName, href, children }, ref) => {
    const pathname = usePathname();
    const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

    return (
      <Link
        ref={ref}
        href={href}
        className={cn(className, isActive && activeClassName)}
      >
        {children}
      </Link>
    );
  }
);

NavLink.displayName = "NavLink";

export { NavLink };
