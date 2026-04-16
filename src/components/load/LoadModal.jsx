import React, { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProjectGallery } from './ProjectGallery';
import { 
  FileUp, 
  Plus
} from 'lucide-react';

export function LoadModal({
  open,
  onOpenChange,
  onLoadFromDb,
  onLoadFromFile,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.stretch')) {
      onLoadFromFile(file);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle>Load Project</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 px-6 border-b bg-muted/10 shrink-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Project Library
            </h2>
          </div>
          
          <ScrollArea className="flex-1">
            <ProjectGallery
              header={
                <div
                  className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-all group aspect-[4/3] bg-muted/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <p className="text-xs font-semibold">Import Project</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Select .stretch file</p>
                  <input
                    type="file"
                    accept=".stretch"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              }
              onSelect={(p) => {
                onLoadFromDb(p);
                onOpenChange(false);
              }}
            />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
