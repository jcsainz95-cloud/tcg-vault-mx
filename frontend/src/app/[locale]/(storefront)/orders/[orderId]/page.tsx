import { OrderDetailView } from './OrderDetailView';

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  return <OrderDetailView orderId={params.orderId} />;
}
