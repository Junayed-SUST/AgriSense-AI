'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Leaf,
  Loader2,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from 'lucide-react';

type Language = 'en' | 'bn';

interface ImageAssessment {
  isPlantLeaf: boolean;
  quality: 'good' | 'fair' | 'poor';
  limitations: string[];
}

interface CropResult {
  canonicalName: string;
  displayName: string;
  visualMatchScore: number;
}

interface DiseaseCandidate {
  canonicalDiseaseName: string;
  displayName: string;
  visualMatchScore: number;
  symptomsSeen: string[];
  whyPossible: string;
  whatWouldDifferentiate: string;
}

interface DetectionResult {
  imageAssessment: ImageAssessment;
  crop: CropResult;
  diagnosisStatus: 'healthy' | 'possible_disease' | 'uncertain' | 'not_leaf';
  statusLabel: string;
  candidates: DiseaseCandidate[];
  questions: string[];
  nextSteps: string[];
  model: string;
  analysisNature: string;
}

export function PlantDiseaseDetector({
  language = 'en',
  sessionId,
  cropHint,
}: {
  language?: Language;
  sessionId: string;
  cropHint?: string | null;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const handleDetect = async () => {
    if (!selectedFile || !sessionId) return;
    setLoading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('image', selectedFile);
      form.append('sessionId', sessionId);
      form.append('language', language);
      if (cropHint) form.append('cropHint', cropHint);

      const response = await fetch('/api/disease-detection', {
        method: 'POST',
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Disease analysis failed');
      setResult(data.result);
    } catch (err: any) {
      setError(err.message || 'Disease analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const statusColor = result?.diagnosisStatus === 'possible_disease'
    ? 'bg-amber-600'
    : result?.diagnosisStatus === 'healthy'
      ? 'bg-emerald-600'
      : result?.diagnosisStatus === 'not_leaf'
        ? 'bg-slate-600'
        : 'bg-sky-600';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-white shadow-2xl">
      <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {language === 'bn' ? 'GPT ভিশন বিশ্লেষণ' : 'GPT Vision Analysis'}
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-100">
            <Leaf className="h-5 w-5 text-emerald-400" />
            {language === 'bn' ? 'পাতার রোগ শনাক্তকরণ' : 'Leaf Disease Detection'}
          </h3>
        </div>
        {result && <Badge className={`${statusColor} text-white`}>{result.statusLabel}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
        <div className="flex flex-col gap-3 md:col-span-5">
          <div className="relative rounded-xl border-2 border-dashed border-slate-700 bg-slate-800/40 p-4 text-center transition-colors hover:border-emerald-500/50">
            {previewUrl ? (
              <div className="relative">
                <img
                  src={previewUrl}
                  alt="Uploaded plant leaf"
                  className="h-56 w-full rounded-lg border border-slate-800 bg-slate-950 object-contain"
                />
                <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700">
                  <UploadCloud className="h-4 w-4" />
                  {language === 'bn' ? 'ছবি বদলান' : 'Change Image'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center py-10">
                <UploadCloud className="mb-2 h-10 w-10 text-slate-400" />
                <span className="text-sm font-semibold text-slate-200">
                  {language === 'bn' ? 'পাতার ছবি আপলোড করুন' : 'Upload a Leaf Photo'}
                </span>
                <span className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>

          <Button
            onClick={handleDetect}
            disabled={!selectedFile || loading || !sessionId}
            className="w-full bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-500"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading
              ? (language === 'bn' ? 'GPT বিশ্লেষণ করছে...' : 'Analyzing with GPT...')
              : (language === 'bn' ? 'রোগ বিশ্লেষণ করুন' : 'Analyze Disease')}
          </Button>

          {error && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="md:col-span-7">
          {!result && !loading && (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center">
              <Eye className="mb-3 h-12 w-12 text-slate-600" />
              <h4 className="font-semibold text-slate-300">
                {language === 'bn' ? 'আপলোডের অপেক্ষায়' : 'Waiting for an Uploaded Leaf'}
              </h4>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                {language === 'bn'
                  ? 'একটি বাস্তব পাতার ছবি দিন। GPT ছবির দৃশ্যমান লক্ষণ দেখে সম্ভাব্য রোগ বা অনিশ্চয়তা জানাবে।'
                  : 'Upload a real leaf photo. GPT will inspect visible symptoms and return a conservative disease triage.'}
              </p>
            </div>
          )}

          {loading && (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center">
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-emerald-400" />
              <div className="text-sm font-semibold text-emerald-300">
                {language === 'bn' ? 'পাতার দৃশ্যমান লক্ষণ বিশ্লেষণ হচ্ছে...' : 'Inspecting visible leaf symptoms...'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {language === 'bn' ? 'এটি নিশ্চিত রোগ নির্ণয় নয়, প্রাথমিক ভিজ্যুয়াল ট্রায়াজ।' : 'This is visual triage, not a confirmed lab diagnosis.'}
              </div>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700/80 bg-slate-800/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                      <Leaf className="h-3.5 w-3.5 text-emerald-400" />
                      {result.crop.displayName || result.crop.canonicalName || 'Uncertain crop'}
                    </div>
                    <h3 className="mt-1 text-xl font-bold text-slate-100">{result.statusLabel}</h3>
                  </div>
                  <Badge className={`${statusColor} text-white`}>{result.imageAssessment.quality}</Badge>
                </div>
                <div className="mt-3 border-t border-slate-700/50 pt-3">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-400">{language === 'bn' ? 'ফসল মিল' : 'Crop visual match'}</span>
                    <span className="font-bold text-emerald-400">{result.crop.visualMatchScore}/100</span>
                  </div>
                  <Progress value={result.crop.visualMatchScore} className="h-1.5 bg-slate-900" />
                </div>
              </div>

              {result.candidates.length > 0 && (
                <div className="space-y-2">
                  {result.candidates.map((candidate, index) => (
                    <div key={`${candidate.canonicalDiseaseName}-${index}`} className="rounded-lg border border-slate-800 bg-slate-800/40 p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <h5 className="text-sm font-bold text-slate-100">{candidate.displayName}</h5>
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
                          {candidate.visualMatchScore}/100
                        </Badge>
                      </div>
                      <div className="space-y-2 text-xs text-slate-300">
                        <div>
                          <span className="font-semibold text-amber-400">{language === 'bn' ? 'দৃশ্যমান লক্ষণ: ' : 'Visible signs: '}</span>
                          {candidate.symptomsSeen.join(', ') || 'Insufficient visible symptoms'}
                        </div>
                        <div>
                          <span className="font-semibold text-emerald-400">{language === 'bn' ? 'কেন সম্ভাব্য: ' : 'Why possible: '}</span>
                          {candidate.whyPossible || 'No clear explanation returned.'}
                        </div>
                        <div>
                          <span className="font-semibold text-sky-400">{language === 'bn' ? 'নিশ্চিত করতে দেখুন: ' : 'Check to differentiate: '}</span>
                          {candidate.whatWouldDifferentiate || 'More photos or field context needed.'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.nextSteps.length > 0 && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {language === 'bn' ? 'পরবর্তী পদক্ষেপ' : 'Next Steps'}
                  </div>
                  <ul className="list-inside list-disc space-y-1">
                    {result.nextSteps.map((step, index) => <li key={index}>{step}</li>)}
                  </ul>
                </div>
              )}

              {result.questions.length > 0 && (
                <div className="rounded-lg border border-sky-800/40 bg-sky-950/30 p-3 text-xs text-sky-200">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-sky-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {language === 'bn' ? 'আরও তথ্য লাগবে' : 'Helpful Details to Confirm'}
                  </div>
                  <ul className="list-inside list-disc space-y-1">
                    {result.questions.map((question, index) => <li key={index}>{question}</li>)}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {language === 'bn' ? 'সতর্কতা' : 'Caution'}
                </div>
                {result.analysisNature}. {language === 'bn'
                  ? 'রাসায়নিক ব্যবহারের আগে স্থানীয় কৃষি কর্মকর্তা বা উদ্ভিদ রোগ বিশেষজ্ঞের পরামর্শ নিন।'
                  : 'Confirm with a local extension officer or plant pathologist before applying chemicals.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
