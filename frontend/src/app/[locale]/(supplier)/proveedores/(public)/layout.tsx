import { SupplierBrandBar } from '@/components/supplier/SupplierBrandBar';

export default function SupplierPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <SupplierBrandBar />
      <main id="main" className="mx-auto w-full max-w-md px-5 py-10">{children}</main>
    </div>
  );
}
