'use client';

import { ArrowTrendingUpIcon, BoltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

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
          <div
            key={metric.id}
            className="relative overflow-hidden rounded-3xl border border-white/40 bg-white/95 p-4 sm:p-6 text-[#052a3b] shadow-lg transition hover:border-white/60 hover:bg-white"
          >
            <div className="absolute inset-0 opacity-80">
              <div className={`absolute -top-12 right-0 h-32 w-32 rounded-full blur-3xl ${metric.glow || 'bg-[#0496c7]/28'}`} />
            </div>
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/85">{metric.label}</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-[#052a3b]">{metric.value}</span>
                  {metric.delta && (
                    <span className={`text-xs font-medium ${metric.delta > 0 ? 'text-[#0e9f6e]' : 'text-[#2f617a]'}`}>
                      {metric.delta > 0 ? `▲ ${metric.delta}` : metric.delta === 0 ? 'No change' : `▼ ${Math.abs(metric.delta)}`}
                    </span>
                  )}
                </div>
                {metric.helper && <p className="mt-2 text-sm text-[#2f617a]">{metric.helper}</p>}
              </div>
              <div className="rounded-2xl bg-[#0496c7]/12 p-3 text-[#036586] shadow-inner shadow-[#0496c7]/20">
                <Icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
