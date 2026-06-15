import { cn } from '../../lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  const sizeClasses = {
    sm: 'h-3 w-3 border-[1.5px]',
    md: 'h-5 w-5 border-2',
    lg: 'h-8 w-8 border-[3px]',
  };
  return (
    <span
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn('inline-block animate-spin rounded-full border-current border-r-transparent', sizeClasses[size], className)}
    />
  );
}
