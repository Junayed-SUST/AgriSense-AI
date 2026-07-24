'use client';

import React, { useState } from 'react';
import { simulateScenario } from '@/lib/agent/tools/tier1_tools';

export function ScenarioSimulator() {
  const [cropId, setCropId] = useState('potato');
  const [farmSizeDecimal, setFarmSizeDecimal] = useState(100);
  const [scenarioType, setScenarioType] = useState<'budget_cut_percent' | 'rainfall_change_percent' | 'selling_price_change_percent' | 'input_price_change_percent' | 'sowing_delay_days'>('budget_cut_percent');
  const [changeValue, setChangeValue] = useState(30);

  const result = simulateScenario({
    cropId,
    farmSizeDecimal,
    scenarioType,
    changeValue,
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <div>
          <span className="bg-emerald-500/10 text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-500/20">
            Tier 1 Advanced Feature
          </span>
          <h3 className="text-lg font-bold mt-1 text-slate-100 flex items-center gap-2">
            📊 Deterministic Scenario Simulator
          </h3>
        </div>
        <div className="text-right text-xs text-slate-400">
          Powered by AgriSense Real Data Pack
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="block text-xs text-slate-400 mb-1 font-medium">Target Crop</label>
          <select
            value={cropId}
            onChange={(e) => setCropId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="potato">Potato (গোল আলু)</option>
            <option value="tomato">Tomato (টমেটো)</option>
            <option value="maize">Maize (ভুট্টা)</option>
            <option value="rice-aman">T. Aman Rice (আমোন ধান)</option>
            <option value="wheat">Wheat (গম - BARI Gom-28)</option>
            <option value="mustard">Mustard (সরিষা)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1 font-medium">Farm Size (Decimals)</label>
          <input
            type="number"
            value={farmSizeDecimal}
            onChange={(e) => setFarmSizeDecimal(Number(e.target.value) || 100)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1 font-medium">Scenario Type</label>
          <select
            value={scenarioType}
            onChange={(e) => setScenarioType(e.target.value as any)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="budget_cut_percent">Budget Cut % (বাজেট কমানো)</option>
            <option value="rainfall_change_percent">Rainfall Change % (বৃষ্টিপাত পরিবর্তন)</option>
            <option value="selling_price_change_percent">Selling Price Change % (বাজার মূল্য)</option>
            <option value="input_price_change_percent">Input Price Change %</option>
            <option value="sowing_delay_days">Sowing Delay Days (রোপণ বিলম্ব)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1 font-medium">
            Change Value: <span className="text-emerald-400 font-bold">{changeValue}{scenarioType === 'sowing_delay_days' ? ' Days' : '%'}</span>
          </label>
          <input
            type="range"
            min={scenarioType === 'sowing_delay_days' ? 1 : scenarioType === 'budget_cut_percent' ? 0 : -50}
            max={scenarioType === 'sowing_delay_days' ? 30 : 50}
            value={changeValue}
            onChange={(e) => setChangeValue(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>
      </div>

      {/* Comparison Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Total Cost (৳)</div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm line-through text-slate-500">৳{result.baseline.totalCostBdt.toLocaleString()}</span>
            <span className="text-lg font-bold text-amber-400">৳{result.simulated.totalCostBdt.toLocaleString()}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Delta: <span className={result.impactDelta.costDeltaBdt <= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {result.impactDelta.costDeltaBdt > 0 ? '+' : ''}৳{result.impactDelta.costDeltaBdt.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Net Profit (৳)</div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm line-through text-slate-500">৳{result.baseline.expectedNetProfitBdt.toLocaleString()}</span>
            <span className="text-lg font-bold text-emerald-400">৳{result.simulated.expectedNetProfitBdt.toLocaleString()}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Delta: <span className={result.impactDelta.profitDeltaBdt >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {result.impactDelta.profitDeltaBdt > 0 ? '+' : ''}৳{result.impactDelta.profitDeltaBdt.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">ROI % & Break-even</div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm line-through text-slate-500">{result.baseline.roiPercent}%</span>
            <span className="text-lg font-bold text-cyan-400">{result.simulated.roiPercent}%</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Break-even price: <span className="text-slate-200">৳{result.simulated.breakEvenPricePerUnit}/{result.unit}</span>
          </div>
        </div>
      </div>

      {/* Explanation Banner */}
      <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-lg p-3 text-xs text-emerald-200">
        <span className="font-semibold text-emerald-400">AgriSense Engine Rationale:</span> {result.explanation}
        {result.simulated.fundingShortfallBdt > 0 && (
          <div className="mt-1 text-amber-300">Funding shortfall: ৳{result.simulated.fundingShortfallBdt.toLocaleString()}. Required inputs were not silently reduced.</div>
        )}
        {result.assumptions.map((assumption, index) => (
          <div key={index} className="mt-1 text-slate-300">Assumption: {assumption}</div>
        ))}
      </div>
    </div>
  );
}
