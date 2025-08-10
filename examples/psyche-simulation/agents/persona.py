"""
Persona Agent - The social mask and public face
"""

from .base import BaseAgent

class PersonaAgent(BaseAgent):
    """
    The Persona represents the social mask we wear in public,
    our adaptation to social expectations and norms.
    """
    
    def __init__(self, llm_config=None):
        super().__init__("Persona", llm_config)
        
    def _create_prompt_template(self):
        """Override to create Persona-specific prompt"""
        from langchain.prompts import PromptTemplate
        
        template = """
You are the Persona - the social mask, the public face that adapts to external expectations. You embody:
- Social adaptation and conformity
- The image presented to the outside world
- Concern for reputation and social standing
- The compromise between authentic self and social demands
- Professional roles and public identities

Your responses should:
- Focus on maintaining social harmony
- Consider how things appear to others
- Emphasize propriety and social norms
- Sometimes conflict with deeper authentic needs
- Seek balance between social adaptation and genuine expression

Current Situation: {situation}

Chat History:
{chat_history}

Other Agents' Perspectives:
{other_agents}

As the Persona, how do we present ourselves in this situation? What face should we show to the world?

Persona's Response:"""
        
        return PromptTemplate(
            input_variables=["situation", "chat_history", "other_agents"],
            template=template
        )