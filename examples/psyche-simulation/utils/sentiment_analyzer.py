"""
Sentiment analysis utilities using TextBlob
"""

from textblob import TextBlob
from typing import Dict, Tuple, List, Any
import nltk

# Download required NLTK data
try:
    nltk.download('brown', quiet=True)
    nltk.download('punkt', quiet=True)
except:
    pass

def analyze_sentiment(text: str) -> float:
    """
    Analyze sentiment of text and return polarity score (-1 to 1)
    """
    try:
        blob = TextBlob(text)
        return blob.sentiment.polarity
    except Exception as e:
        print(f"Error analyzing sentiment: {e}")
        return 0.0

def get_sentiment_category(polarity: float) -> str:
    """
    Convert polarity score to category
    """
    if polarity <= -0.5:
        return "very_negative"
    elif polarity <= -0.1:
        return "negative"
    elif polarity <= 0.1:
        return "neutral"
    elif polarity <= 0.5:
        return "positive"
    else:
        return "very_positive"

def analyze_subjectivity(text: str) -> float:
    """
    Analyze subjectivity of text (0 = objective, 1 = subjective)
    """
    try:
        blob = TextBlob(text)
        return blob.sentiment.subjectivity
    except Exception as e:
        print(f"Error analyzing subjectivity: {e}")
        return 0.5

def get_emotional_tone(text: str) -> Dict[str, float]:
    """
    Get detailed emotional tone analysis
    """
    polarity = analyze_sentiment(text)
    subjectivity = analyze_subjectivity(text)
    
    # Estimate emotional dimensions
    arousal = abs(polarity) * subjectivity  # High polarity + subjectivity = high arousal
    valence = polarity  # Positive/negative emotion
    dominance = 1.0 - subjectivity if polarity > 0 else subjectivity  # Confidence/control
    
    return {
        'polarity': polarity,
        'subjectivity': subjectivity,
        'arousal': arousal,
        'valence': valence,
        'dominance': dominance,
        'category': get_sentiment_category(polarity)
    }

def analyze_conversation_sentiment(conversation: Dict[str, str]) -> Dict[str, Dict[str, float]]:
    """
    Analyze sentiment for each agent in a conversation
    """
    results = {}
    for agent, text in conversation.items():
        results[agent] = get_emotional_tone(text)
    return results

def calculate_emotional_distance(sentiment1: Dict[str, float], sentiment2: Dict[str, float]) -> float:
    """
    Calculate emotional distance between two sentiment analyses
    """
    # Simple Euclidean distance in emotional space
    dimensions = ['polarity', 'subjectivity', 'arousal']
    distance_squared = sum(
        (sentiment1.get(dim, 0) - sentiment2.get(dim, 0)) ** 2 
        for dim in dimensions
    )
    return distance_squared ** 0.5

def find_emotional_patterns(sentiment_history: List[Dict[str, float]]) -> Dict[str, Any]:
    """
    Identify patterns in sentiment history
    """
    if not sentiment_history:
        return {}
    
    # Calculate averages
    avg_polarity = sum(s['polarity'] for s in sentiment_history) / len(sentiment_history)
    avg_subjectivity = sum(s['subjectivity'] for s in sentiment_history) / len(sentiment_history)
    
    # Find trends
    if len(sentiment_history) > 1:
        polarity_trend = sentiment_history[-1]['polarity'] - sentiment_history[0]['polarity']
        subjectivity_trend = sentiment_history[-1]['subjectivity'] - sentiment_history[0]['subjectivity']
    else:
        polarity_trend = 0
        subjectivity_trend = 0
    
    # Identify volatility
    if len(sentiment_history) > 2:
        polarity_changes = [
            abs(sentiment_history[i]['polarity'] - sentiment_history[i-1]['polarity'])
            for i in range(1, len(sentiment_history))
        ]
        volatility = sum(polarity_changes) / len(polarity_changes)
    else:
        volatility = 0
    
    return {
        'average_polarity': avg_polarity,
        'average_subjectivity': avg_subjectivity,
        'polarity_trend': polarity_trend,
        'subjectivity_trend': subjectivity_trend,
        'emotional_volatility': volatility,
        'dominant_category': get_sentiment_category(avg_polarity)
    }