import * as React from "react";

type AnyComponent = React.ComponentType<any> & { [key: string]: any };

declare module "@/components/ui/*" {
  import * as React from "react";
  const Component: React.ComponentType<any> & { [key: string]: any };
  export default Component;
  export const Accordion: React.ComponentType<any>;
  export const AccordionItem: React.ComponentType<any>;
  export const AccordionTrigger: React.ComponentType<any>;
  export const AccordionContent: React.ComponentType<any>;
  export const AlertDialog: React.ComponentType<any>;
  export const AlertDialogTrigger: React.ComponentType<any>;
  export const AlertDialogContent: React.ComponentType<any>;
  export const AlertDialogHeader: React.ComponentType<any>;
  export const AlertDialogFooter: React.ComponentType<any>;
  export const AlertDialogTitle: React.ComponentType<any>;
  export const AlertDialogDescription: React.ComponentType<any>;
  export const AlertDialogAction: React.ComponentType<any>;
  export const AlertDialogCancel: React.ComponentType<any>;
  export const Alert: React.ComponentType<any>;
  export const AlertTitle: React.ComponentType<any>;
  export const AlertDescription: React.ComponentType<any>;
  export const AspectRatio: React.ComponentType<any>;
  export const Avatar: React.ComponentType<any>;
  export const AvatarImage: React.ComponentType<any>;
  export const AvatarFallback: React.ComponentType<any>;
  export const Badge: React.ComponentType<any>;
  export const Breadcrumb: React.ComponentType<any>;
  export const Button: React.ComponentType<any>;
  export const Calendar: React.ComponentType<any>;
  export const Card: React.ComponentType<any>;
  export const CardHeader: React.ComponentType<any>;
  export const CardFooter: React.ComponentType<any>;
  export const CardTitle: React.ComponentType<any>;
  export const CardDescription: React.ComponentType<any>;
  export const CardContent: React.ComponentType<any>;
  export const Checkbox: React.ComponentType<any>;
  export const Collapsible: React.ComponentType<any>;
  export const Command: React.ComponentType<any>;
  export const ContextMenu: React.ComponentType<any>;
  export const Dialog: React.ComponentType<any>;
  export const DialogTrigger: React.ComponentType<any>;
  export const DialogContent: React.ComponentType<any>;
  export const DialogHeader: React.ComponentType<any>;
  export const DialogFooter: React.ComponentType<any>;
  export const DialogTitle: React.ComponentType<any>;
  export const DialogDescription: React.ComponentType<any>;
  export const Drawer: React.ComponentType<any>;
  export const DropdownMenu: React.ComponentType<any>;
  export const DropdownMenuTrigger: React.ComponentType<any>;
  export const DropdownMenuContent: React.ComponentType<any>;
  export const DropdownMenuItem: React.ComponentType<any>;
  export const DropdownMenuCheckboxItem: React.ComponentType<any>;
  export const DropdownMenuRadioItem: React.ComponentType<any>;
  export const DropdownMenuLabel: React.ComponentType<any>;
  export const DropdownMenuSeparator: React.ComponentType<any>;
  export const DropdownMenuShortcut: React.ComponentType<any>;
  export const DropdownMenuGroup: React.ComponentType<any>;
  export const DropdownMenuPortal: React.ComponentType<any>;
  export const DropdownMenuSub: React.ComponentType<any>;
  export const DropdownMenuSubContent: React.ComponentType<any>;
  export const DropdownMenuSubTrigger: React.ComponentType<any>;
  export const DropdownMenuRadioGroup: React.ComponentType<any>;
  export const Form: React.ComponentType<any>;
  export const HoverCard: React.ComponentType<any>;
  export const Input: React.ComponentType<any>;
  export const InputOTP: React.ComponentType<any>;
  export const Label: React.ComponentType<any>;
  export const Menubar: React.ComponentType<any>;
  export const NavigationMenu: React.ComponentType<any>;
  export const Pagination: React.ComponentType<any>;
  export const Popover: React.ComponentType<any>;
  export const PopoverTrigger: React.ComponentType<any>;
  export const PopoverContent: React.ComponentType<any>;
  export const Progress: React.ComponentType<any>;
  export const RadioGroup: React.ComponentType<any>;
  export const Resizable: React.ComponentType<any>;
  export const ScrollArea: React.ComponentType<any>;
  export const Select: React.ComponentType<any>;
  export const SelectGroup: React.ComponentType<any>;
  export const SelectValue: React.ComponentType<any>;
  export const SelectTrigger: React.ComponentType<any>;
  export const SelectContent: React.ComponentType<any>;
  export const SelectLabel: React.ComponentType<any>;
  export const SelectItem: React.ComponentType<any>;
  export const SelectSeparator: React.ComponentType<any>;
  export const Separator: React.ComponentType<any>;
  export const Sheet: React.ComponentType<any>;
  export const SheetTrigger: React.ComponentType<any>;
  export const SheetClose: React.ComponentType<any>;
  export const SheetContent: React.ComponentType<any>;
  export const SheetHeader: React.ComponentType<any>;
  export const SheetFooter: React.ComponentType<any>;
  export const SheetTitle: React.ComponentType<any>;
  export const SheetDescription: React.ComponentType<any>;
  export const Skeleton: React.ComponentType<any>;
  export const Slider: React.ComponentType<any>;
  export const Sonner: React.ComponentType<any>;
  export const Toaster: React.ComponentType<any>;
  export const Switch: React.ComponentType<any>;
  export const Table: React.ComponentType<any>;
  export const Tabs: React.ComponentType<any>;
  export const TabsList: React.ComponentType<any>;
  export const TabsTrigger: React.ComponentType<any>;
  export const TabsContent: React.ComponentType<any>;
  export const Textarea: React.ComponentType<any>;
  export const Toast: React.ComponentType<any>;
  export const Toggle: React.ComponentType<any>;
  export const ToggleGroup: React.ComponentType<any>;
  export const Tooltip: React.ComponentType<any>;
}

declare module "@/hooks/*" {
  const content: any;
  export default content;
  export const useToast: any;
  export const toast: any;
}

declare module "@/lib/utils" {
  export function cn(...inputs: any[]): string;
}

declare module "@/constants/*" {
  const content: any;
  export default content;
}
