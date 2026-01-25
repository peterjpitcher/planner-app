'use client';

import { ArrowTrendingUpIcon, BoltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';

const iconMap = {
  default: BoltIcon,
  trending: ArrowTrendingUpIcon,
  warning: ExclamationTriangleIcon,
};

export default function MetricsBar({ metrics = [] }) {
  if (!metrics.length) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6 lg:mb-8">
      {metrics.map((metric) => {
        const Icon = metric.icon || iconMap[metric.intent || 'default'];
        return (
          <Card
            key={metric.id}
            className="relative overflow-hidden transition-all hover:bg-muted/50"
          >
            <div className="absolute inset-0 opacity-10">
              <div className={cn(
                "absolute -top-12 right-0 h-32 w-32 rounded-full blur-3xl",
                metric.glow || "bg-primary" // Use theme primary if no specific glow
              )} />
            </div>
            <CardContent className="p-6 relative flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{metric.label}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-foreground">{metric.value}</span>
                  {metric.delta && (
                    <span className={cn(
                      "text-xs font-medium",
                      metric.delta > 0 ? "text-green-600" : "text-muted-foreground"
                    )}>
                      {metric.delta > 0 ? `▲ ${metric.delta}` : metric.delta === 0 ? 'No change' : `▼ ${Math.abs(metric.delta)}`}
                    </span>
                  )}
                </div>
                {metric.helper && <p className="mt-1 text-sm text-muted-foreground">{metric.helper}</p>}
              </div>
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
