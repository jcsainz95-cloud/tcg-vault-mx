import { SupplierShell } from '@/components/supplier/SupplierShell';

export default function SupplierPortalLayout({ children }: { children: React.ReactNode }) {
  return <SupplierShell>{children}</SupplierShell>;
}
