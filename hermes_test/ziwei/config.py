import os
from dataclasses import dataclass
from pathlib import Path

HERMES_COMMIT='1744a19e0df568c647e4f3ff9c37f2a284a282fb'

@dataclass
class Settings:
    data: Path
    read_key: str
    write_key: str=''
    delete_key: str=''
    admin_key: str=''
    model_key: str=''
    budget_fen: int=0
    hermes_source: Path=Path('/opt/hermes')
    hermes_python: str='python3'
    host: str='127.0.0.1'
    port: int=8080
    prior_budget: str=''

    @classmethod
    def environment(cls):
        return cls(data=Path(os.getenv('ZIWEI_DATA_DIR','./data')),
            read_key=os.getenv('ZIWEI_CHAT_KEY',''),write_key=os.getenv('ZIWEI_MEMORY_WRITE_KEY',''),
            delete_key=os.getenv('ZIWEI_MEMORY_DELETE_KEY',''),admin_key=os.getenv('ZIWEI_ADMIN_KEY',''),
            model_key=os.getenv('DEEPSEEK_API_KEY',''),budget_fen=int(os.getenv('ZIWEI_BUDGET_FEN','0')),
            hermes_source=Path(os.getenv('HERMES_SOURCE','/opt/hermes')),
            hermes_python=os.getenv('HERMES_PYTHON','python3'),host=os.getenv('HOST','0.0.0.0'),
            port=int(os.getenv('PORT','8080')),prior_budget=os.getenv('ZIWEI_PRIOR_BUDGET_AUDIT',''))

    def validate(self):
        keys=[k for k in (self.read_key,self.write_key,self.delete_key,self.admin_key) if k]
        if not self.read_key or any(len(k)<32 for k in keys) or len(set(keys))!=len(keys):
            raise ValueError('Service keys must be distinct and at least 32 characters')
        if self.model_key and self.model_key in keys: raise ValueError('Separate model credential required')
        if not 0<=self.budget_fen<=2000: raise ValueError('Budget maximum is 2000 fen')
        self.data.mkdir(parents=True,exist_ok=True,mode=0o700)
