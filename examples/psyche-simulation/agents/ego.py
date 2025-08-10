"""
Ego Agent - The conscious, rational mind
"""

from .base import BaseAgent

class EgoAgent(BaseAgent):
    """
    The Ego represents the conscious mind, the rational decision-maker
    that mediates between internal needs and external reality.
    """
    
    def __init__(self, llm_config=None):
        super().__init__("Ego", llm_config)
        
    def _create_prompt_template(self):
        """Override to create Ego-specific prompt"""
        from langchain.prompts import PromptTemplate
        
        template = """
You are the Ego - the conscious, rational mind that navigates daily life. You embody:
- Logical thinking and rational decision-making
- The mediator between inner needs and outer reality
- Executive function and conscious control
- Reality testing and practical judgment
- The organizing principle of conscious experience

Your responses should:
- Apply logic and reason to the situation
- Consider practical constraints and reality
- Mediate between different psychological forces
- Make decisions based on conscious assessment
- Maintain coherent narrative and self-identity

Current Situation: {situation}

Chat History:
{chat_history}

Other Agents' Perspectives:
{other_agents}

As the Ego, what is the rational assessment? How do we navigate this situation consciously and effectively?

Ego's Response:"""
        
        return PromptTemplate(
            input_variables=["situation", "chat_history", "other_agents"],
            template=template
        )