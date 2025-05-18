import { addDays, nextFriday, nextMonday, endOfMonth, format, setDay, startOfWeek } from 'date-fns';

export const quickPickOptions = [
  {
    label: 'Tomorrow',
    getValue: () => format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  },
  {
    label: '+2 Days',
    getValue: () => format(addDays(new Date(), 2), 'yyyy-MM-dd'),
  },
  {
    label: 'This Friday',
    getValue: () => format(nextFriday(new Date()), 'yyyy-MM-dd'),
  },
  {
    label: 'Next Monday',
    // To ensure it's always the upcoming Monday, even if today is Monday
    getValue: () => {
      const today = new Date();
      let target = nextMonday(today);
      // If today is Monday, nextMonday gives today. We want next week's Monday in that case.
      if (format(target, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') && today.getDay() === 1) {
        target = addDays(target, 7);
      }
      return format(target, 'yyyy-MM-dd');
    },
  },
  {
    label: 'End Next Week',
    // Friday of the next calendar week
    getValue: () => format(setDay(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7), 5), 'yyyy-MM-dd'),
  },
  {
    label: 'End of Month',
    getValue: () => format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  },
]; 