import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#18181b] group-[.toaster]:text-zinc-200 group-[.toaster]:border-white/10 group-[.toaster]:shadow-lg group-[.toaster]:shadow-black/40",
          description: "group-[.toast]:text-zinc-400",
          actionButton:
            "group-[.toast]:bg-purple-600 group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-300",
          success: "group-[.toaster]:!border-emerald-500/20",
          error: "group-[.toaster]:!border-rose-500/20",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
