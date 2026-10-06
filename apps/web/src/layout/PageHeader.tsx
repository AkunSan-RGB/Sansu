import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';

export default function PageHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {extra}
    </Flex>
  );
}
