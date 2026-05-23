// EdgeRails — framing component for every order-handling screen.
// Draws a 4px blue buyer rail on the left and a 4px green supplier rail on the right,
// each capped by a port marker. The children are the actual page content.

import { RailPort } from "./MarkSystem";

interface EdgeRailsProps {
  children: React.ReactNode;
  className?: string;
}

export function EdgeRails({ children, className }: EdgeRailsProps) {
  return (
    <div className={`relative flex-1 overflow-hidden ${className ?? ""}`}>
      {/* Left — buyer / blue rail */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[26px] flex-col items-center">
        <RailPort color="buyer" />
        <div
          className="flex-1 w-[4px] mt-1"
          style={{
            background:
              "linear-gradient(180deg, #1E66C9 0%, rgba(30,102,201,0.15) 100%)",
          }}
        />
      </div>

      {/* Right — supplier / green rail */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[26px] flex-col items-center">
        <RailPort color="supplier" />
        <div
          className="flex-1 w-[4px] mt-1"
          style={{
            background:
              "linear-gradient(180deg, #2E8E3A 0%, rgba(46,142,58,0.15) 100%)",
          }}
        />
      </div>

      {/* Content — offset by rail width so nothing clips behind the rails */}
      <div className="absolute inset-0 overflow-auto" style={{ left: 26, right: 26 }}>
        {children}
      </div>
    </div>
  );
}
