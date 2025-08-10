"""
Dynamic Prompt Evolution Manager
Adapts agent prompts based on conversation dynamics
"""

import logging
import time
from typing import Dict, List, Optional, Any, Tuple
from collections import deque
from langchain.prompts import PromptTemplate

from analysis.sentiment import analyze_sentiment, find_emotional_patterns
from config import ANALYSIS_CONFIG

class DynamicPromptManager:
    """
    Manages adaptive prompts based on conversation dynamics
    """
    
    def __init__(self, history_window: int = 20):
        self.logger = logging.getLogger("DynamicPromptManager")
        self.history_window = history_window
        
        # Track conversation history
        self.conversation_history = deque(maxlen=history_window)
        
        # Adaptation rules
        self.adaptation_rules = {
            'high_conflict': {
                'threshold': 0.7,
                'adaptation': "Focus on finding common ground and integration. Seek to understand rather than oppose."
            },
            'low_engagement': {
                'threshold': 0.3,
                'adaptation': "Challenge the current perspective more directly. Bring fresh energy and new angles."
            },
            'repetitive': {
                'threshold': 0.6,
                'adaptation': "Introduce new perspectives and break familiar patterns. Explore unexplored territories."
            },
            'stagnant': {
                'threshold': 0.5,
                'adaptation': "Take a different approach. What hasn't been said? What new direction could open up?"
            },
            'highly_emotional': {
                'threshold': 0.8,
                'adaptation': "Acknowledge the strong emotions present. Balance feeling with understanding."
            }
        }
        
        # Track prompt adaptations
        self.adaptation_history = {}
        
    def analyze_conversation_state(self, agent_outputs: Dict[str, str]) -> Dict[str, float]:
        """
        Analyze the current state of the conversation
        """
        # Add to history
        if agent_outputs:
            self.conversation_history.append(agent_outputs)
        
        # Calculate various metrics
        conflict_score = self._measure_conflict()
        engagement_score = self._measure_engagement()
        diversity_score = self._measure_diversity()
        repetition_score = self._measure_repetition()
        emotional_intensity = self._measure_emotional_intensity()
        
        state = {
            'conflict': conflict_score,
            'engagement': engagement_score,
            'diversity': diversity_score,
            'repetition': repetition_score,
            'emotional_intensity': emotional_intensity,
            'stagnation': 1.0 - (engagement_score * diversity_score)
        }
        
        self.logger.info(f"Conversation state: {state}")
        
        return state
    
    def adapt_prompt(self, base_prompt: PromptTemplate, agent_name: str, 
                    conversation_state: Dict[str, float]) -> PromptTemplate:
        """
        Adapt a prompt based on conversation dynamics
        """
        adaptations = []
        
        # Check each rule
        if conversation_state['conflict'] > self.adaptation_rules['high_conflict']['threshold']:
            adaptations.append(self.adaptation_rules['high_conflict']['adaptation'])
        
        if conversation_state['engagement'] < self.adaptation_rules['low_engagement']['threshold']:
            adaptations.append(self.adaptation_rules['low_engagement']['adaptation'])
        
        if conversation_state['repetition'] > self.adaptation_rules['repetitive']['threshold']:
            adaptations.append(self.adaptation_rules['repetitive']['adaptation'])
        
        if conversation_state['stagnation'] > self.adaptation_rules['stagnant']['threshold']:
            adaptations.append(self.adaptation_rules['stagnant']['adaptation'])
        
        if conversation_state['emotional_intensity'] > self.adaptation_rules['highly_emotional']['threshold']:
            adaptations.append(self.adaptation_rules['highly_emotional']['adaptation'])
        
        # Apply adaptations
        if adaptations:
            adapted_template = base_prompt.template + "\n\nAdditional guidance for this response:\n" + "\n".join(f"- {a}" for a in adaptations)
            
            # Track adaptation
            self.adaptation_history[agent_name] = {
                'timestamp': time.time(),
                'adaptations': adaptations,
                'state': conversation_state.copy()
            }
            
            return PromptTemplate(
                input_variables=base_prompt.input_variables,
                template=adapted_template
            )
        
        return base_prompt
    
    def _measure_conflict(self) -> float:
        """
        Measure the level of conflict in recent conversation
        """
        if len(self.conversation_history) < 2:
            return 0.0
        
        conflict_markers = ANALYSIS_CONFIG['conflict_markers']
        conflict_count = 0
        total_count = 0
        
        for turn in self.conversation_history:
            if isinstance(turn, dict):
                for agent, text in turn.items():
                    total_count += 1
                    text_lower = text.lower()
                    for marker in conflict_markers:
                        if marker in text_lower:
                            conflict_count += 1
                            break
        
        # Also consider sentiment divergence
        sentiment_divergence = self._calculate_sentiment_divergence()
        
        conflict_score = (conflict_count / max(total_count, 1)) * 0.7 + sentiment_divergence * 0.3
        
        return min(conflict_score, 1.0)
    
    def _measure_engagement(self) -> float:
        """
        Measure the level of engagement (response length, complexity)
        """
        if not self.conversation_history:
            return 0.5
        
        recent_turns = list(self.conversation_history)[-5:]
        
        total_length = 0
        total_responses = 0
        
        for turn in recent_turns:
            if isinstance(turn, dict):
                for agent, text in turn.items():
                    total_length += len(text.split())
                    total_responses += 1
        
        if total_responses == 0:
            return 0.5
        
        avg_length = total_length / total_responses
        
        # Normalize (assume 50-200 words is good engagement)
        engagement = min(avg_length / 150, 1.0)
        
        return engagement
    
    def _measure_diversity(self) -> float:
        """
        Measure topic/vocabulary diversity
        """
        if len(self.conversation_history) < 3:
            return 1.0
        
        # Collect all recent words
        all_words = []
        recent_turns = list(self.conversation_history)[-5:]
        
        for turn in recent_turns:
            if isinstance(turn, dict):
                for agent, text in turn.items():
                    words = text.lower().split()
                    all_words.extend(words)
        
        if not all_words:
            return 1.0
        
        # Calculate vocabulary diversity
        unique_words = set(all_words)
        diversity = len(unique_words) / len(all_words)
        
        return diversity
    
    def _measure_repetition(self) -> float:
        """
        Measure how repetitive the conversation has become
        """
        if len(self.conversation_history) < 3:
            return 0.0
        
        # Compare recent turns for similarity
        recent_turns = list(self.conversation_history)[-5:]
        
        similarity_scores = []
        
        for i in range(1, len(recent_turns)):
            prev_turn = recent_turns[i-1]
            curr_turn = recent_turns[i]
            
            # Simple word overlap measure
            for agent in set(prev_turn.keys()) & set(curr_turn.keys()):
                if agent in prev_turn and agent in curr_turn:
                    prev_words = set(prev_turn[agent].lower().split())
                    curr_words = set(curr_turn[agent].lower().split())
                    
                    if prev_words and curr_words:
                        overlap = len(prev_words & curr_words) / len(prev_words | curr_words)
                        similarity_scores.append(overlap)
        
        if similarity_scores:
            return sum(similarity_scores) / len(similarity_scores)
        
        return 0.0
    
    def _measure_emotional_intensity(self) -> float:
        """
        Measure the emotional intensity of the conversation
        """
        if not self.conversation_history:
            return 0.0
        
        recent_turns = list(self.conversation_history)[-5:]
        
        sentiments = []
        for turn in recent_turns:
            if isinstance(turn, dict):
                for agent, text in turn.items():
                    sentiment = abs(analyze_sentiment(text))
                    sentiments.append(sentiment)
        
        if sentiments:
            return sum(sentiments) / len(sentiments)
        
        return 0.0
    
    def _calculate_sentiment_divergence(self) -> float:
        """
        Calculate how divergent agent sentiments are
        """
        if not self.conversation_history:
            return 0.0
        
        last_turn = self.conversation_history[-1]
        
        if len(last_turn) < 2:
            return 0.0
        
        sentiments = [analyze_sentiment(text) for text in last_turn.values()]
        
        # Calculate variance
        mean_sentiment = sum(sentiments) / len(sentiments)
        variance = sum((s - mean_sentiment) ** 2 for s in sentiments) / len(sentiments)
        
        # Normalize (assume max variance is around 1.0)
        return min(variance, 1.0)
    
    def get_adaptation_history(self, agent_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Get adaptation history for an agent or all agents
        """
        if agent_name:
            return self.adaptation_history.get(agent_name, {})
        return self.adaptation_history
    
    def suggest_intervention(self, conversation_state: Dict[str, float]) -> Optional[str]:
        """
        Suggest an intervention based on conversation state
        """
        suggestions = []
        
        if conversation_state['conflict'] > 0.8:
            suggestions.append("Consider introducing a mediating perspective or finding common ground")
        
        if conversation_state['stagnation'] > 0.7:
            suggestions.append("Try introducing a new question or shifting the focus")
        
        if conversation_state['emotional_intensity'] > 0.9:
            suggestions.append("Allow space for emotions while encouraging reflection")
        
        if conversation_state['repetition'] > 0.7:
            suggestions.append("Break the pattern by exploring a different angle")
        
        return "; ".join(suggestions) if suggestions else None