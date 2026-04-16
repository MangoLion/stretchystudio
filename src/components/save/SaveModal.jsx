import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { saveProject } from '@/io/projectFile';
import { saveToDb } from '@/io/projectDb';
import { Loader2, Download, Library, AlertTriangle } from 'lucide-react';
import { ProjectGallery } from '@/components/load/ProjectGallery';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function SaveModal({
  open,
  onOpenChange,
  project,
  captureRef,
  currentDbProjectId,
  currentDbProjectName,
  onSavedToDb,
}) {
  const [name, setName] = useState('');
  const [saveMode, setSaveMode] = useState('library'); // 'library' | 'download'
  const [isSaving, setIsSaving] = useState(false);
  const [overwriteProject, setOverwriteProject] = useState(null);
  const [libraryProjects, setLibraryProjects] = useState([]);

  useEffect(() => {
    if (open) {
      setName(currentDbProjectName || 'Untitled Project');
      setSaveMode(currentDbProjectId ? 'library' : 'library'); // Default to library now we have a gallery
      setIsSaving(false);
    }
  }, [open, currentDbProjectId, currentDbProjectName]);

  const executeSave = async (idToUse, nameToUse, mode) => {
    setIsSaving(true);
    try {
      const blob = await saveProject(project);
      
      if (mode === 'download') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nameToUse.trim()}.stretch`;
        a.click();
        URL.revokeObjectURL(url);
        onOpenChange(false);
      } else {
        const thumbnail = captureRef.current?.() || '';
        const savedId = await saveToDb(
          idToUse,
          nameToUse.trim(),
          blob,
          thumbnail
        );
        onSavedToDb(savedId, nameToUse.trim());
        onOpenChange(false);
      }
    } catch (err) {
      console.error('Failed to save project:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNew = () => {
    if (!name.trim()) return;

    if (saveMode === 'library') {
      // Check if project with this name already exists in library
      const existing = libraryProjects.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        setOverwriteProject(existing);
        return;
      }
    }

    executeSave(saveMode === 'library' ? currentDbProjectId : null, name, saveMode);
  };

  const handleOverwrite = (p) => {
    setOverwriteProject(p);
  };

  const confirmOverwrite = () => {
    if (!overwriteProject) return;
    executeSave(overwriteProject.id, overwriteProject.name, 'library');
    setOverwriteProject(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle>Save Project</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Save New / Download Section - Fixed at top */}
            <div className="p-6 border-b bg-muted/20 shrink-0">
              <div className="flex flex-col gap-4 max-w-lg">
                <div className="grid gap-2">
                  <Label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Project Name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter project name..."
                      className="h-10"
                    />
                    <Button onClick={handleSaveNew} disabled={isSaving || !name.trim()} className="shrink-0 h-10 px-6">
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>

                <RadioGroup value={saveMode} onValueChange={setSaveMode} className="flex gap-6 mt-1">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="library" id="save-library" />
                    <Label htmlFor="save-library" className="text-sm cursor-pointer flex items-center gap-1.5 font-medium">
                      <Library className="h-4 w-4" /> Save to Library
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="download" id="save-download" />
                    <Label htmlFor="save-download" className="text-sm cursor-pointer flex items-center gap-1.5 font-medium">
                      <Download className="h-4 w-4" /> Download File
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            {/* Project Gallery - Scrollable */}
            <ScrollArea className="flex-1">
              <ProjectGallery 
                className="bg-muted/5"
                onSelect={handleOverwrite} 
                onProjectsLoaded={setLibraryProjects}
              />
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Overwrite Confirmation */}
      <AlertDialog 
        open={!!overwriteProject} 
        onOpenChange={(open) => !open && setOverwriteProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Overwrite project?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to overwrite <strong>"{overwriteProject?.name}"</strong>? 
              This will replace the project data and thumbnail in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmOverwrite}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
