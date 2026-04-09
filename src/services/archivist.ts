import { WikiCandidate } from '../types';
import { api } from './api';

export async function processWikiCandidates(candidates: WikiCandidate[], roomId: string, userId: string, onProgress?: (msg: string) => void) {
  if (!candidates || candidates.length === 0) return;
  
  if (onProgress) onProgress(`Архивариус изучает новые записи...`);
  
  try {
    await api.processArchivist(roomId, candidates);
  } catch (error) {
    console.error("Failed to process wiki candidates:", error);
  } finally {
    if (onProgress) onProgress('');
  }
}
